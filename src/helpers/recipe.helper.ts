import { RecipeInstruction, RecipeTimestamp } from '../models/recipe.model';

export class RecipeHelper {
  static mapInstructions(plainIngredients: string[], timestamps: RecipeTimestamp[]): RecipeInstruction[] {
    return timestamps.length
      ? timestamps.map(({ step, startTime, endTime }) => ({
        step,
        text: plainIngredients[step - 1],
        videoStartTime: startTime,
        videoEndTime: endTime,
      }))
      : plainIngredients.map((text, index) => ({ step: index + 1, text }));
  }
}
