// const IgDownloader = require('ig-downloader').IgDownloader;
// const fs = require('fs');
// const axios = require('axios');
//
// async function fetchInstagramData() {
//   try {
//     const data = await IgDownloader('https://www.instagram.com/reel/DDNI0thxZNy/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==');
//     console.log(data.video_url);
//     if (data.video_url) {
//       await downloadVideo(data.video_url, 'video.mp4');
//     }
//
//   } catch (e) {
//     console.error(e);
//   }
// }
//
// async function downloadVideo(videoUrl, outputPath) {
//   try {
//     const response = await axios({
//       method: 'GET',
//       url: videoUrl,
//       responseType: 'stream', // Ensures the response is treated as a stream
//     });
//
//     // Create a write stream to save the video
//     const writer = fs.createWriteStream(outputPath);
//
//     // Pipe the video stream to the file
//     response.data.pipe(writer);
//
//     // Wait for the download to finish
//     return new Promise((resolve, reject) => {
//       writer.on('finish', () => {
//         console.log(`Video downloaded successfully to ${outputPath}`);
//         resolve();
//       });
//       writer.on('error', reject);
//     });
//   } catch (error) {
//     console.error('Error downloading video:', error.message);
//   }
// }
//
// fetchInstagramData()