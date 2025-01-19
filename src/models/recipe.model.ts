export interface RecipeIngredient {
  name: string;
  amount: string;
  measurementUnit?: string;
}

export interface Recipe {
  title: string;
  description: string;
  cookingMethod: string;
  ingredients: RecipeIngredient[];
  portionsCount?: number;
}