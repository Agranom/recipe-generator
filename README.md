Architecture overview:

This service generates a recipe from the social medias (instagram).

Technologies:
- OpenAI
- LangChain
- NodeJS


## Initial setup

Install husky

`npx husky-init && husky install`

## Run locally during development:

`npm run dev`

NOTE: You have to create `.env` file with `OPENAI_API_KEY` variables.

## Build and deploy

To deploy to Cloud Run:

`npm run deploy`


Service URL:

`https://recipe-generator-584335420311.us-west1.run.app`
