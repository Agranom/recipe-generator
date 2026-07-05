import 'reflect-metadata'; // first — TypeDI decorators need it at import time

// Non-empty bucket name so GoogleStorageService's constructor doesn't throw when
// the container builds the controller graph. Never used directly — GCS is faked below.
process.env.GOOGLE_CLOUD_BUCKET_NAME = 'test-bucket';

// Neutralize the retry wrapper so a rejecting boundary surfaces immediately —
// the retry loop itself is covered by retry.util's own unit tests.
jest.mock('../../shared/utils/retry.util', () => ({ retry: (fn: () => unknown) => fn() }));

// Fake the leaf SDKs (hoisted above the imports). @langchain/openai is the
// boundary under test for this endpoint; the other SDKs are faked only so
// sibling services' constructors boot when the controller graph is built.
const mockParseRecipe = jest.fn();
jest.mock('@langchain/openai', () => ({
  // withStructuredOutput() is piped onto a real prompt, so the fake must be a
  // function (LangChain wraps it in a RunnableLambda) — NOT an { invoke } object.
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue(() => mockParseRecipe()),
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
jest.mock('axios');

import request from 'supertest';
import { createApp } from '../../app';
import { RecipeMetadata } from '../../models/recipe-metadata.model';
import { GeneratedRecipe } from '../../models/recipe.model';

describe('POST /generateFromInstagram', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /generateFromInstagram returns 200 with the parsed recipe when instructions already exist and no video is present', async () => {
    // hasInstructions: true and no videoFile — skips generateInstructionsFromVideo,
    // timestamp alignment, and GCS publishing; only the OpenAI parse chain runs.
    const metadata: RecipeMetadata = {
      description: 'A tasty pasta recipe.\n\n1. Boil water.\n2. Cook pasta.',
      hasInstructions: true,
      imageUrl: 'https://cdn.example.com/i.jpg',
    };

    const generatedRecipe: GeneratedRecipe = {
      title: 'Pasta',
      description: 'A tasty pasta recipe',
      instructions: ['Boil water.', 'Cook pasta.'],
      portionsCount: 2,
      ingredients: [{ name: 'Pasta', amount: '200', measurementUnit: 'g' }],
    };
    mockParseRecipe.mockResolvedValue(generatedRecipe);

    const res = await request(app)
      .post('/generateFromInstagram')
      .send({ metadata, targetLanguage: 'english', useMetricSystem: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      title: 'Pasta',
      description: 'A tasty pasta recipe',
      portionsCount: 2,
      ingredients: [{ name: 'Pasta', amount: '200', measurementUnit: 'g' }],
      instructions: [
        { step: 1, text: 'Boil water.' },
        { step: 2, text: 'Cook pasta.' },
      ],
    });
    expect(mockParseRecipe).toHaveBeenCalledTimes(1);
  });

  it('POST /generateFromInstagram returns 500 when the OpenAI parse chain fails', async () => {
    const metadata: RecipeMetadata = {
      description: 'A tasty pasta recipe.\n\n1. Boil water.\n2. Cook pasta.',
      hasInstructions: true,
    };
    mockParseRecipe.mockRejectedValue(new Error('OpenAI is down'));

    const res = await request(app)
      .post('/generateFromInstagram')
      .send({ metadata, targetLanguage: 'english', useMetricSystem: false });

    expect(res.status).toBe(500);
    expect(res.text).toBe('Internal server error');
  });
});
