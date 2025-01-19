// //
// const OpenAI = require('openai');
// const fs = require('fs');
// const openAIKey = ''
// // ===============================
// // TRANSCRIBE AUDIO WITH OPENAI WHISPER
// // ===============================
// async function transcribeAudio(audioPath) {
//   // Initialize OpenAI with your API key
//   const openai = new OpenAI({ apiKey: openAIKey });
//
//   // Create a readable stream for the audio file
//   const audioStream = fs.createReadStream(audioPath);
//
//   try {
//     // Whisper model is typically "whisper-1"
//     const response = await openai.audio.transcriptions.create({
//       file: audioStream,
//       model: 'whisper-1',
//     })
//
//     return response.text;
//   } catch (error) {
//     throw new Error(`Error in OpenAI Whisper transcription: ${error.message}`);
//   }
// }
//
// transcribeAudio('output-audio.mp3');
//
// module.exports = {
//   transcribeAudio,
// }