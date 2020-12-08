const axios = require('axios');
const {exec, execSync} = require('child_process');
const express = require('express');
const _ = require('lodash');
const fs = require('fs');
const azureUpload = require('./upload.js');
const bodyParser = require('body-parser');

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
                const sideBySideMergeAndUrl = async (agentFileName, userFileName, mergedFileName) => {
                    await execSync(`ffmpeg -y -acodec libopus -i /recording-merged/${agentFileName}.webm -i /recording-merged/${userFileName
                    }.webm -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" /recording-final/${mergedFileName}.webm`);
                    const userMergedVideoFileData = await fs.readFileSync(`/recording-final/${mergedFileName}.webm`);
                    return azureUpload.createSasUrl(userMergedVideoFileData, `uploaded-${mergedFileName}.webm`);
                };

                const convertMjrToStandardAv = async (userFileAudio, userFileVideo) => {
                    const tasks = [
                        execSync(`janus-pp-rec /recording-data/${userFileAudio} /recording-pp/${userFileAudio}.opus`),
                        execSync(`janus-pp-rec /recording-data/${userFileVideo} /recording-pp/${userFileVideo}.webm`),
                    ];
                    await Promise.all(tasks);
                    console.log("convertMjrToStandardAv");
                };

                const mergeAvAndUpload = async (agentFileAudio, agentFileVideo, agentFileName) => {
                    await execSync(`ffmpeg -y -acodec libopus -i /recording-pp/${agentFileAudio}.opus -i /recording-pp/${
                        agentFileVideo}.webm -c:v copy -c:a opus -strict experimental /recording-merged/${agentFileName}.webm`);
                    const agentMergedVideoFileData = await fs.readFileSync(`/recording-merged/${agentFileName}.webm`);
                    return await azureUpload.createSasUrl(agentMergedVideoFileData, `uploaded-${agentFileName}.webm`);
                };

                // TODO: pick only most recent if many
                let agentFileAudio, agentFileVideo;
                agentFiles.map((x) => {
                    if (x.endsWith('audio.mjr')) agentFileAudio = x;
                    else if (x.endsWith('video.mjr')) agentFileVideo = x;
                });
                let userFileAudio, userFileVideo;
                userFiles.map((x) => {
                    if (x.endsWith('audio.mjr')) userFileAudio = x;
                    else if (x.endsWith('video.mjr')) userFileVideo = x;
                });

                await convertMjrToStandardAv(agentFileAudio, agentFileVideo);
                await convertMjrToStandardAv(userFileAudio, userFileVideo);
                const agentFileUrl = await mergeAvAndUpload(agentFileAudio, agentFileVideo, agentFileName);
                const userFileUrl = await mergeAvAndUpload(userFileAudio, userFileVideo, userFileName);

                const finalMergedFileUrl = sideBySideMergeAndUrl(agentFileName, userFileName, callLog._id);
                console.log(finalMergedFileUrl, agentFileUrl, userFileUrl, "merged urls");

                res.send({
                    success: true,
                    message: 'Merged the videos',
                    data: {
                        mergedFileUrl: finalMergedFileUrl,
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
