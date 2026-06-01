export interface RecipeIngredient {
  name: string;
  amount: string;
  measurementUnit?: string;
}

export interface RecipeInstruction {
  step: number;
  text: string;
  videoStartTime?: string;
  videoEndTime?: string;
}

export interface RecipeTimestamp {
  step: number;
  startTime: string;
  endTime: string;
}

export interface GeneratedRecipe {
  title: string;
  description: string;
  instructions: string[];
  ingredients: RecipeIngredient[];
  portionsCount?: number;
}

export interface Recipe extends Omit<GeneratedRecipe, 'instructions'> {
  instructions: RecipeInstruction[];
  videoUrl?: string;
}
