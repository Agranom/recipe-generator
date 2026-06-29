import 'reflect-metadata';
import { RecipeInstructionsService } from '../recipe-instructions.service';
import { RecipeVideoMetadata } from '../../models/recipe-metadata.model';
import { Logger } from '../../shared/interfaces/logger.interface';
import { GoogleStorageService } from '../../shared/services/google-storage.service';

const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    ARRAY: 'ARRAY',
    INTEGER: 'INTEGER',
    NUMBER: 'NUMBER',
  },
}));

describe('RecipeInstructionsService', () => {
  let logger: jest.Mocked<Logger>;
  let storageService: Pick<GoogleStorageService, 'getFileGsutilUrl'> & {
    getFileGsutilUrl: jest.Mock;
  };
  let service: RecipeInstructionsService;

  const mockFile: RecipeVideoMetadata = {
    fileId: 'abc123',
    fileName: 'test-video.mp4',
    url: 'https://example.com/test-video.mp4',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
    };
    storageService = {
      getFileGsutilUrl: jest.fn().mockReturnValue('gs://test-bucket/tmp/test-video.mp4'),
    };
    service = new RecipeInstructionsService(
      storageService as unknown as GoogleStorageService,
      logger
    );
  });

  describe('generateInstructionsFromVideo', () => {
    it('returns parsed instructions and timestamps on success', async () => {
      const payload = {
        instructions: '1. Chop onions.\n2. Sauté in oil.',
        timestamps: [
          { step: 1, startTime: '00:05', endTime: '00:15' },
          { step: 2, startTime: '00:20', endTime: '00:45' },
        ],
      };
      mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(payload) });

      const result = await service.generateInstructionsFromVideo(mockFile);

      expect(result.instructions).toBe(payload.instructions);
      expect(result.timestamps).toEqual(payload.timestamps);
    });

    it('throws when response text is empty and logs the error', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: undefined });

      await expect(service.generateInstructionsFromVideo(mockFile)).rejects.toThrow(
        'No text found in the response'
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't generate instructions"),
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it('re-throws API errors and logs them', async () => {
      const apiError = new Error('Network error');
      mockGenerateContent.mockRejectedValueOnce(apiError);

      await expect(service.generateInstructionsFromVideo(mockFile)).rejects.toThrow(
        'Network error'
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't generate instructions"),
        expect.objectContaining({ err: apiError })
      );
    });
  });

  describe('getTimestamps', () => {
    const instructions = ['Chop onions', 'Sauté in oil'];

    it('returns timestamps array on success', async () => {
      const timestamps = [
        { step: 1, startTime: '00:05', endTime: '00:15' },
        { step: 2, startTime: '00:20', endTime: '00:45' },
      ];
      mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ timestamps }) });

      const result = await service.getTimestamps(instructions, mockFile);

      expect(result).toEqual(timestamps);
    });

    it('returns [] and logs a warning when the response has no timestamps key', async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({}) });

      const result = await service.getTimestamps(instructions, mockFile);

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith('Timestamps are empty');
    });

    it('deduplicates timestamps by step number', async () => {
      const timestamps = [
        { step: 1, startTime: '00:05', endTime: '00:15' },
        { step: 1, startTime: '00:10', endTime: '00:20' },
      ];
      mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ timestamps }) });

      const result = await service.getTimestamps(instructions, mockFile);

      expect(result).toHaveLength(1);
      expect(result[0].step).toBe(1);
    });

    it('returns [] and logs an error when the API call fails', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API failure'));

      const result = await service.getTimestamps(instructions, mockFile);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't get timestamps"),
        expect.objectContaining({ err: expect.any(Error) })
      );
    });
  });
});
