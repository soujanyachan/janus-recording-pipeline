/* required libraries */
const axios = require('axios');
const {execSync} = require('child_process');
const express = require('express');
const _ = require('lodash');
const fs = require('fs');
const chokidar = require('chokidar');
const bodyParser = require('body-parser');
const ffmpeg = require('fluent-ffmpeg');

/* required files */
const azureUpload = require('./upload.js');

/* global constants */
const app = express();
const avPairs = {};

/* middleware */
app.use(bodyParser.json({limit: '10mb'}));

/* helper functions */
const createFileBaseNameFromCallLog = (callLog) => {
    const {botId, uid, ticketId, userSessionId, agentId, userHandleId, agentSessionId, agentHandleId} = callLog;
    const userFileName = `user_${ticketId}_${botId}_${uid}_${userSessionId}_${userHandleId}_${callLog._id}`;
    const agentFileName = `agent_${botId}_${agentId}_${agentSessionId}_${agentHandleId}_${callLog._id}`;
    return [agentFileName, userFileName];
};

/*
 explanation of the ffmpeg commands:

 ** ffmpeg -y -acodec libopus -i input.opus -i input.webm -c:v copy -c:a opus -strict experimental output.webm
 Using audio codec libopus to prevent https://trac.ffmpeg.org/ticket/4641
 -c:v copy tells FFmpeg to copy the bitstream of the video to the output. (no re-encoding)
 -c:a opus re-encode to opus
 -strict experimental Specifies how strictly to follow the standards, and to allow non-standard things.

 ** ffmpeg -y -acodec libopus -i video1 -i video2 -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" outputVideo
 [0:v] refers to the first video stream in the first input file, [1:v] to the first video stream in the second file.
 Scale is set to 480:640.
 The setsar filter sets the Sample (aka Pixel) Aspect Ratio for the filter output video as 1.
 First input set as left side and second input set as the right side.
 Hstack stacks left and right input videos horizontally.
 Amix mixes the two audio tracks.
 */

const ffmpegSideBySideMergeAsync = (agentFileName, userFileName, mergedFileName, storageType) => {
    return new Promise((resolve, reject) => {
        let input1 = agentFileName;
        let input2 = userFileName;
        if (storageType === 'pvc'){
            input1 = `/recording-merged/${agentFileName}.webm`;
            input2 = `/recording-merged/${userFileName}.webm`;
        }
        ffmpeg()
            .input(input1)
            .input(input2)
            .complexFilter("[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix")
            .saveToFile(`/recording-final/${mergedFileName}.webm`)
            .on('end', async () => {
                try {
                    if (storageType === 'pvc') {
                        await fs.unlinkSync(input1);
                        await fs.unlinkSync(input2);
                    }
                    resolve();
                } catch (e) {
                    reject(new Error(e));
                }
            })
            .on('error', (err) => reject(new Error(err)))
    });
};

const ffmpegMergeAvAsync = (agentFileAudio, agentFileVideo, agentFileName) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .addInput(`/recording-pp/${agentFileAudio}.opus`)
            .audioCodec('opus')
            .input(`/recording-pp/${agentFileVideo}.webm`)
            .videoCodec('copy')
            .saveToFile(`/recording-merged/${agentFileName}.webm`)
            .on('end', async () => {
                try {
                    await fs.unlinkSync(`/recording-pp/${agentFileAudio}.opus`);
                    await fs.unlinkSync(`/recording-pp/${agentFileVideo}.webm`);
                    resolve();
                } catch (e) {
                    reject(new Error(e));
                }
            })
            .on('error', (err) => reject(new Error(err)))
    })
};

const sideBySideMergeAndUrl = async (agentFileName, userFileName, mergedFileName, storageType) => {
    await ffmpegSideBySideMergeAsync(agentFileName, userFileName, mergedFileName, storageType);
    const userMergedVideoFileData = await fs.readFileSync(`/recording-final/${mergedFileName}.webm`);
    const mergedUrl = await azureUpload.createSasUrl(userMergedVideoFileData, `uploaded-${mergedFileName}.webm`);
    await fs.unlinkSync(`/recording-final/${mergedFileName}.webm`);
    return mergedUrl;
};

const convertMjrToStandardAv = async (userFileAudio, userFileVideo) => {
    const tasks = [
        execSync(`janus-pp-rec /recording-data/${userFileAudio} /recording-pp/${userFileAudio}.opus`),
        execSync(`janus-pp-rec /recording-data/${userFileVideo} /recording-pp/${userFileVideo}.webm`),
    ];
    const [opLog1, opLog2] = await Promise.all(tasks);
    console.log(opLog1.toString(), "janus-pp-rec log 1");
    console.log(opLog2.toString(), "janus-pp-rec log 2");
    await fs.unlinkSync(`/recording-data/${userFileAudio}`);
    await fs.unlinkSync(`/recording-data/${userFileVideo}`);
    console.log("convertMjrToStandardAv");
};

const mergeAvAndUpload = async (agentFileAudio, agentFileVideo, agentFileName) => {
    await ffmpegMergeAvAsync(agentFileAudio, agentFileVideo, agentFileName);
    const agentMergedVideoFileData = await fs.readFileSync(`/recording-merged/${agentFileName}.webm`);
    return await azureUpload.createSasUrl(agentMergedVideoFileData, `uploaded-${agentFileName}.webm`);
};

/* file watcher */
chokidar.watch('/recording-data', {
    awaitWriteFinish: {
        stabilityThreshold: 2000, //Amount of time in milliseconds for a file size to remain constant before emitting its event.
        pollInterval: 100 // File size polling interval, in milliseconds.
    },
}).on(
    'add',
    async (path) => {
    const splitPath = path.split('_');
    const callLogId = _.first(_.last(splitPath).split('-'));
    if (!avPairs[callLogId]) avPairs[callLogId] = {};

    if (path.startsWith('user') && path.includes('audio')) {
            avPairs[callLogId]['userAudio'] = path;
    } else if (path.startsWith('user') && path.includes('video')) {
            avPairs[callLogId]['userVideo'] = path;
    } else if (path.startsWith('agent') && path.includes('audio')) {
            avPairs[callLogId]['agentAudio'] = path;
    } else if (path.startsWith('agent') && path.includes('video')) {
            avPairs[callLogId]['agentVideo'] = path;
    }

    if (_.keys(avPairs[callLogId]).length === 4) {
        const {agentAudio, agentVideo, userAudio, userVideo} = avPairs[callLogId];
        await convertMjrToStandardAv(agentAudio, agentVideo);
        await convertMjrToStandardAv(userAudio, userVideo);
        const agentFileUrl = await mergeAvAndUpload(agentAudio, agentVideo, agentVideo);
        const userFileUrl = await mergeAvAndUpload(userAudio, userVideo, userVideo);
        const updateCallLogResponse = await axios.post('http://agents-service.services:3000/janus/internal/updateCallLogByCallLogId', {
            callLogId,
            data: {
                agentRecordingId: agentFileUrl,
                userRecordingId: userFileUrl,
            }
        });
        console.log(updateCallLogResponse, "updateCallLogResponse from chokidar");
    }
});

/* express routes */
app.get('/list-recordings', async (req, res) => {
    try {
        const fileList = await fs.readdirSync('/recording-data');
        res.send({
            success: true,
            message: 'Fetched list of recordings.',
            data: fileList
        });
    } catch (e) {
        res.send({
            success: false,
            message: `Error in fetching list of recordings: ${e.message}`,
        });
    }
});

app.post('/process-recordings', async (req, res) => {
    try {
        const callLog = req.body.callLog;
        const storageType = req.body.storageType || 'pvc';
        const [agentFileName, userFileName] = createFileBaseNameFromCallLog(callLog);
        console.log(agentFileName, userFileName, "base file names");
        let agentFiles, userFiles;
        try {
            if (!callLog) {
                throw new Error('Calllog required');
            }
            if (storageType === 'pvc') {
                const pvcDir = '/recording-data/';
                const files = await fs.readdirSync(pvcDir);
                files.sort(function (a, b) {
                    return fs.statSync(pvcDir + a).mtime.getTime() -
                        fs.statSync(pvcDir + b).mtime.getTime();
                });
                // console.log(files);
                agentFiles = _.filter(files, (x) => x.startsWith(agentFileName));
                userFiles = _.filter(files, (x) => x.startsWith(userFileName));
                console.log(agentFiles, userFiles);
                if (!agentFiles.length) {
                    throw new Error('Agent video data not found.');
                } else if (!userFiles.length) {
                    throw new Error('User video not found.');
                }
            }
            await res.send({
                success: true,
                message: `started processing the recording ${callLog._id}`,
                data: callLog
            });
        } catch (e) {
            console.log('sending response 2 ', e.message);
            return res.send({
                success: false,
                message: e.message
            });
        }
        if (storageType === 'pvc' && !_.isEmpty(agentFiles) && !_.isEmpty(userFiles)) {
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
            console.log(agentFileAudio, "agentFileAudio");
            console.log(agentFileVideo, "agentFileVideo");
            console.log(userFileAudio, "userFileAudio");
            console.log(userFileVideo, "userFileVideo");

            await convertMjrToStandardAv(agentFileAudio, agentFileVideo);
            await convertMjrToStandardAv(userFileAudio, userFileVideo);
            const agentFileUrl = await mergeAvAndUpload(agentFileAudio, agentFileVideo, agentFileName);
            const userFileUrl = await mergeAvAndUpload(userFileAudio, userFileVideo, userFileName);

            const finalMergedFileUrl = await sideBySideMergeAndUrl(agentFileName, userFileName, callLog._id, storageType);
            console.log(finalMergedFileUrl, agentFileUrl, userFileUrl, "merged urls");
            try {
                const updateCallLogResponse = await axios.post('http://agents-service.services:3000/janus/internal/updateCallLogByCallLogId', {
                    callLogId: callLog._id,
                    data: {
                        mergedRecordingUrl: finalMergedFileUrl,
                        agentRecordingId: agentFileUrl,
                        userRecordingId: userFileUrl,
                    }
                });
                console.log(updateCallLogResponse, "updateCallLogResponse");
            } catch (e) {
                console.log(`error in sending to agent service after processing ${e.message}`);
            }
        } else if (req.body.videoUrls || (callLog.userRecordingId && callLog.agentRecordingId)) {
            const agentVideoUrl = _.get(req.body, 'videoUrls.agentVideoUrl', '') || callLog.agentRecordingId;
            const userVideoUrl = _.get(req.body, 'videoUrls.userVideoUrl', '') || callLog.userRecordingId;
            if (agentVideoUrl && userVideoUrl) {
                await ffmpegSideBySideMergeAsync(agentVideoUrl, userVideoUrl, callLog._id, storageType);
                const mergedVideoFileData = await fs.readFileSync(`/recording-final/${callLog._id}.webm`);
                const mergedUrl = await azureUpload.createSasUrl(mergedVideoFileData, `uploaded-${callLog._id}.webm`)
                try {
                    const updateCallLogResponse = await axios.post('http://agents-service.services:3000/janus/internal/updateCallLogByCallLogId', {
                        callLogId: callLog._id,
                        data: {
                            mergedRecordingUrl: mergedUrl,
                        }
                    });
                    console.log(updateCallLogResponse, "updateCallLogResponse url version");
                    await fs.unlinkSync(`/recording-final/${callLog._id}.webm`);
                } catch (e) {
                    console.log(`error in sending to agent service after processing urls ${e.message}`);
                }
            } else {
                console.log('Missing user video url or agent video url.');
            }
        }
    } catch (e) {
        console.log(e, "general error in process recordings")
    }
});

console.log('listening on port 9999');
app.listen(9999);
