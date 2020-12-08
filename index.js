const axios = require('axios');
const {exec, execSync} = require('child_process');
const express = require('express');
const _ = require('lodash');
const fs = require('fs');
const azureUpload = require('./upload.js');
const bodyParser = require('body-parser');

// add the recorded calls to a bull queue and add them when call is hungup.
// once the audio and the video are converted, send to another queue to merge
// Something to use when events are received.
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

app.get('/list-recordings', (req, res) => {
    exec(`ls -la /recording-data`, (stdout, result, stderr) => {
        console.log(stdout, "stdout");
        console.log(result, "result");
        console.log("done with exec");
    });
    res.sendStatus(200);
});

const createFileBaseNameFromCallLog = (callLog) => {
    const {botId, uid, ticketId, userSessionId, agentId, userHandleId, agentSessionId, agentHandleId} = callLog;
    const userFileName = `user_${ticketId}_${botId}_${uid}_${userSessionId}_${userHandleId}`;
    const agentFileName = `agent_${botId}_${agentId}_${agentSessionId}_${agentHandleId}`;
    return [agentFileName, userFileName];
};

app.post('/process-recordings', async (req, res) => {
    try {
        const callLog = req.body.callLog;
        const storageType = req.body.storageType || 'pvc';
        if (!callLog) {
            throw new Error('Calllog required');
        }
        // check if all the files are available
        const [agentFileName, userFileName] = createFileBaseNameFromCallLog(callLog);
        if (storageType === 'pvc') {
            const files = await fs.readdirSync('/recording-data');
            console.log(files);
            const agentFiles = _.filter(files, (x) => x.startsWith(agentFileName));
            const userFiles = _.filter(files, (x) => x.startsWith(userFileName));
            console.log(agentFiles, userFiles);
            // if not return false
            if (!agentFiles.length) {
                throw new Error('Agent video data not found.');
            } else if (!userFiles.length) {
                throw new Error('User video not found.');
            } else {
                // TODO: pick only most recent if many
                // TODO: refactor this merging to function, with parameters for user/agent
                let agentFileAudio, agentFileVideo;
                agentFiles.map((x) => {
                    if (x.endsWith('audio.mjr')) agentFileAudio = x;
                    else if (x.endsWith('video.mjr')) agentFileVideo = x;
                });
                // console.log(agentFileAudio, agentFileVideo);
                // convert agent audio to opus
                console.log('1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111')
                const agentAudioResult = await execSync(`janus-pp-rec /recording-data/${agentFileAudio} /recording-pp/${
                    agentFileAudio}.opus`);
                // convert agent video to webm
                console.log('22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222')
                const agentVideoResult = await execSync(`janus-pp-rec /recording-data/${agentFileVideo} /recording-pp/${
                    agentFileVideo}.webm`);
                // console.log(agentAudioResult.toString());
                // console.log(agentVideoResult.toString());
                // merge agent
                console.log('3333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333')
                const agentVideoFinalResult = await execSync(`ffmpeg -y -acodec libopus -i /recording-pp/${agentFileAudio}.opus -i /recording-pp/${
                    agentFileVideo}.webm -c:v copy -c:a opus -strict experimental /recording-merged/${agentFileName}.webm`);
                // console.log(agentVideoFinalResult.toString());
                const agentMergedVideoFileData = await fs.readFileSync(`/recording-merged/${agentFileName}.webm`);
                const agentFileUrl = await azureUpload.createSasUrl(agentMergedVideoFileData, `uploaded-${agentFileName}.webm`);

                let userFileAudio, userFileVideo;
                userFiles.map((x) => {
                    if (x.endsWith('audio.mjr')) userFileAudio = x;
                    else if (x.endsWith('video.mjr')) userFileVideo = x;
                });
                // console.log(userFileAudio, userFileVideo);
                // convert user audio to opus
                const userAudioResult = await execSync(`janus-pp-rec /recording-data/${userFileAudio} /recording-pp/${userFileAudio}.opus`);
                // convert user video to webm
                const userVideoResult = await execSync(`janus-pp-rec /recording-data/${userFileVideo} /recording-pp/${userFileVideo}.webm`);
                // console.log(userAudioResult.toString());
                console.log("userVideoResult"); //.toString());
                // merge user
                const userVideoFinalResult = await execSync(`ffmpeg -y -acodec libopus -i /recording-pp/${userFileAudio}.opus -i /recording-pp/${
                    userFileVideo}.webm  -c:v copy -c:a opus -strict experimental /recording-merged/${userFileName}.webm`);
                console.log("userVideoFinalResult") //.toString());
                const userMergedVideoFileData = await fs.readFileSync(`/recording-merged/${userFileName}.webm`);
                const userFileUrl = await azureUpload.createSasUrl(userMergedVideoFileData, `uploaded-${userFileName}.webm`);

                // merge the two videos
                const finalMergedResult = await execSync(`ffmpeg -y -acodec libopus -i /recording-merged/${agentFileName}.webm -i /recording-merged/${userFileName
				}.webm -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" /recording-final/${callLog._id}.webm`);
                console.log("finalMergedResult"); //.toString());
                const finalMergedVideoFileData = await fs.readFileSync(`/recording-final/${callLog._id}.webm`);
                const finalMergedFileUrl = await azureUpload.createSasUrl(finalMergedVideoFileData, `uploaded-${callLog._id}.webm`);
                console.log(finalMergedFileUrl, agentFileUrl, userFileUrl, "merged urls");
                res.send({
                    success: true,
                    message: 'Merged the videos',
                    data: {
                        mergedUrl: finalMergedFileUrl,
                        agentVideoUrl: agentFileUrl,
                        userVideoUrl: userFileUrl,
                    }
                });
            }
        } else {
            console.log('different storage type needs to be configured');
            const storageDataUrls = req.body.storageData;
        }
    } catch (e) {
        res.send({
            success: false,
            message: e.message
        });
    }
});

console.log('listening on port 9999');
app.listen(9999);
