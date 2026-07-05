import 'reflect-metadata'; // first — TypeDI decorators need it at import time

// Non-empty bucket name so GoogleStorageService's constructor doesn't throw when
// the container builds the controller graph. Never used directly — GCS is faked below.
process.env.GOOGLE_CLOUD_BUCKET_NAME = 'test-bucket';

// Fake the leaf SDKs (hoisted above the imports). @google-cloud/storage is the
// boundary under test; the LLM SDKs are faked only so sibling services' constructors boot.
const mockFile = { delete: jest.fn() };
const mockBucket = { file: jest.fn().mockReturnValue(mockFile) };
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({ bucket: jest.fn().mockReturnValue(mockBucket) })),
}));
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn().mockReturnValue((input: unknown) => input),
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
jest.mock('axios');

import request from 'supertest';
import { createApp } from '../../app';

describe('POST /deleteRecipeVideo', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /deleteRecipeVideo returns 204 and deletes the GCS file when publicFileId is provided', async () => {
    mockFile.delete.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/deleteRecipeVideo')
      .send({ publicFileId: 'videos/abc123.mp4' });

    expect(res.status).toBe(204);
    expect(mockBucket.file).toHaveBeenCalledWith('videos/abc123.mp4');
    expect(mockFile.delete).toHaveBeenCalledTimes(1);
  });

  it('POST /deleteRecipeVideo returns 204 and skips the GCS call when publicFileId is absent', async () => {
    const res = await request(app).post('/deleteRecipeVideo').send({});

    expect(res.status).toBe(204);
    expect(mockBucket.file).not.toHaveBeenCalled();
    expect(mockFile.delete).not.toHaveBeenCalled();
  });

  it('POST /deleteRecipeVideo returns 500 when the GCS delete fails', async () => {
    mockFile.delete.mockRejectedValue(new Error('gcs down'));

    const res = await request(app)
      .post('/deleteRecipeVideo')
      .send({ publicFileId: 'videos/abc123.mp4' });

    expect(res.status).toBe(500);
    expect(res.text).toBe('Internal server error');
  });
});
