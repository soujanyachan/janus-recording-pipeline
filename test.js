const azureUpload = require('./upload.js');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const chokidar = require('chokidar');

chokidar.watch('.', {
    awaitWriteFinish: {
        stabilityThreshold: 2000, //Amount of time in milliseconds for a file size to remain constant before emitting its event.
        pollInterval: 100 // File size polling interval, in milliseconds.
    },
}).on('add', (path) => {
    console.log(path);
});
//
// const test = async () => {
//     const audioData = await fs.readFileSync('user_103105_x1580919615924_12617922823921245942957577026_1083821520278279_2085275495914519_1607509741759-audio.mjr');
//     const videoData = await fs.readFileSync('user_103105_x1580919615924_12617922823921245942957577026_1083821520278279_2085275495914519_1607509741759-video.mjr');
//     const audioUrl = await azureUpload.createSasUrl(audioData, 'audio.mjr');
//     const videoUrl = await azureUpload.createSasUrl(videoData, 'video.mjr');
//     console.log(audioUrl,'\n', videoUrl);
//
//     agentVideoUrl = "https://yellowmessenger.blob.core.windows.net/confidential/undefined/HN5s59vgGzfk1607509764941.webm?st=2020-12-09T10%3A29%3A25Z&se=2021-01-08T10%3A29%3A25Z&sp=r&sv=2018-03-28&sr=b&sig=s0Wzrb3gEpokHu3JYxJo0%2B3WG%2F2OdrfV3e40ytMljGU%3D"
//     userVideoUrl = "https://yellowmessenger.blob.core.windows.net/confidential/undefined/tFzUzT0A7tsK1607509766345.webm?st=2020-12-09T10%3A29%3A26Z&se=2021-01-08T10%3A29%3A26Z&sp=r&sv=2018-03-28&sr=b&sig=zOKGYG%2B%2FBaUK%2BZEnfNg%2FrE0ojwfz1ImGmcjUEohBH%2Bg%3D"
//     console.log(`ffmpeg -y -acodec libopus -i "${agentVideoUrl}" -i "${userVideoUrl
//     }" -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" /recording-final/dsjkafjsn134.webm`)
// }
//
// test();

// ffmpeg()
//     .addInput(`bb.opus`)
//     .audioCodec('opus')
//     .input(`bb.webm`)
//     .videoCodec('copy')
//     .saveToFile(`bb-merged.webm`);

// await execSync(`ffmpeg -y -acodec libopus -i /recording-merged/${agentFileName}.webm -i /recording-merged/${userFileName
// }.webm -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" /recording-final/${mergedFileName}.webm`);

// ffmpeg()
//     .input(`big-buck-bunny_trailer.webm`)
//     .input(`big-buck-bunny_trailer.webm`)
//     .complexFilter("[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix")
//     .saveToFile(`output-bunny2.webm`);

// ffmpeg -i big-buck-bunny_trailer.webm -vn -acodec libopus bb.opus -strict experimental
