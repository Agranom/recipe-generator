export class InvalidRecipeError extends Error {
  constructor(message = 'Invalid Recipe') {
    super(message);
  }
}