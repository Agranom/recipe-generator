// const ffmpeg = require('fluent-ffmpeg');
//
// function extractAudio(inputVideoPath, outputAudioPath) {
//   // Create an ffmpeg command
//   ffmpeg(inputVideoPath)
//     // Set the output format to mp3 (you can use other formats like .wav, .m4a, etc.)
//     // .audioBitrate('128k')
//     .toFormat('mp3')
//
//     // Handle ffmpeg errors
//     .on('error', (err) => {
//       console.error('An error occurred while extracting audio: ' + err.message);
//     })
//
//     // Handle successful audio extraction
//     .on('end', () => {
//       console.log(`Audio extraction completed! File saved to ${outputAudioPath}`);
//     })
//
//     // Start processing
//     .save(outputAudioPath);
// }
//
// module.exports = {
//   extractAudio,
// }