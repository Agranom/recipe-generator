import 'reflect-metadata'; // first — TypeDI decorators need it at import time

// Non-empty bucket name so GoogleStorageService's constructor doesn't throw when
// the container builds the whole controller graph. Never used — GCS is faked below.
process.env.GOOGLE_CLOUD_BUCKET_NAME = 'test-bucket';

// Fake the leaf SDKs (hoisted above the imports). axios is the boundary under
// test for this endpoint; the LLM/GCS SDKs are faked only so sibling services'
// constructors boot when the container resolves the full controller graph.
jest.mock('axios');

const mockValidate = jest.fn();
jest.mock('@langchain/openai', () => ({
  // withStructuredOutput() is piped onto a real prompt, so the fake must be a
  // function (LangChain wraps it in a RunnableLambda) — NOT a { invoke } object.
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue(() => mockValidate()),
  })),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    ARRAY: 'ARRAY',
    INTEGER: 'INTEGER',
    NUMBER: 'NUMBER',
  },
}));

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({ bucket: jest.fn() })),
}));

// Neutralize the retry wrapper so a rejecting boundary surfaces immediately —
// the retry logic itself is covered by retry.util's own unit tests.
jest.mock('../../shared/utils/retry.util', () => ({ retry: (fn: () => unknown) => fn() }));

import axios from 'axios';
import request from 'supertest';
import { createApp } from '../../app';

const mockedAxios = axios as jest.Mocked<typeof axios>;

function scrapeCreatorsResponse(media: Record<string, unknown>) {
  return { data: { data: { xdt_shortcode_media: media } } };
}

describe('POST /getInstagramPostMetadata', () => {
  const app = createApp();
  const postUrl = 'https://www.instagram.com/reel/DBHExLYonRH/';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /getInstagramPostMetadata returns 400 when postUrl is missing', async () => {
    const res = await request(app).post('/getInstagramPostMetadata').send({});

    expect(res.status).toBe(400);
    expect(res.text).toBe('postUrl is required');
    expect(mockedAxios.get).not.toHaveBeenCalled(); // rejected before any scraping
  });

  it('POST /getInstagramPostMetadata returns 200 with the mapped metadata for the no-video preview path', async () => {
    mockedAxios.get.mockResolvedValue(
      scrapeCreatorsResponse({
        edge_media_to_caption: { edges: [{ node: { text: 'Pasta' } }] },
        display_url: 'https://cdn.example.com/i.jpg',
      })
    );
    mockValidate.mockResolvedValue({ isRecipe: true, hasInstructions: true, hasIngredients: true });

    const res = await request(app).post('/getInstagramPostMetadata').send({ postUrl });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      description: 'Pasta',
      imageUrl: 'https://cdn.example.com/i.jpg',
      hasInstructions: true,
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('POST /getInstagramPostMetadata returns 400 with the InvalidRecipeError message when the post description is empty', async () => {
    mockedAxios.get.mockResolvedValue(
      scrapeCreatorsResponse({
        edge_media_to_caption: { edges: [] },
        display_url: 'https://cdn.example.com/i.jpg',
      })
    );

    const res = await request(app).post('/getInstagramPostMetadata').send({ postUrl });

    expect(res.status).toBe(400);
    expect(res.text).toBe('Post description is empty');
    // Validation is never reached because the description short-circuits first.
    expect(mockValidate).not.toHaveBeenCalled();
  });

  it('POST /getInstagramPostMetadata returns 500 when the recipe validation boundary throws a generic error', async () => {
    mockedAxios.get.mockResolvedValue(
      scrapeCreatorsResponse({
        edge_media_to_caption: { edges: [{ node: { text: 'Pasta' } }] },
        display_url: 'https://cdn.example.com/i.jpg',
      })
    );
    mockValidate.mockRejectedValue(new Error('LLM boundary exploded'));

    const res = await request(app).post('/getInstagramPostMetadata').send({ postUrl });

    expect(res.status).toBe(500);
    expect(res.text).toBe('Internal server error');
  });
});
