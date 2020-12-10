const axios = require('axios');
const {exec, execSync} = require('child_process');
const express = require('express');
const _ = require('lodash');
const fs = require('fs');
const azureUpload = require('./upload.js');
const bodyParser = require('body-parser');
const ffmpeg = require('fluent-ffmpeg');
// TODO: add chokidar and upload on save files if enabled
const app = express();
app.use(bodyParser.json({limit: '10mb'}));

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

const createFileBaseNameFromCallLog = (callLog) => {
    const {botId, uid, ticketId, userSessionId, agentId, userHandleId, agentSessionId, agentHandleId} = callLog;
    const userFileName = `user_${ticketId}_${botId}_${uid}_${userSessionId}_${userHandleId}_${callLog._id}`;
    const agentFileName = `agent_${botId}_${agentId}_${agentSessionId}_${agentHandleId}_${callLog._id}`;
    return [agentFileName, userFileName];
};

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
    console.log(opLog1, "janus-pp-rec log 1");
    console.log(opLog2, "janus-pp-rec log 2");
    await fs.unlinkSync(`/recording-data/${userFileAudio}`);
    await fs.unlinkSync(`/recording-data/${userFileVideo}`);
    console.log("convertMjrToStandardAv");
};

const mergeAvAndUpload = async (agentFileAudio, agentFileVideo, agentFileName) => {
    await ffmpegMergeAvAsync(agentFileAudio, agentFileVideo, agentFileName);
    const agentMergedVideoFileData = await fs.readFileSync(`/recording-merged/${agentFileName}.webm`);
    return await azureUpload.createSasUrl(agentMergedVideoFileData, `uploaded-${agentFileName}.webm`);
};

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

// const callback2 = function (event) {
//
// 	const combineUserAgentVideos = (callLog, userType, fileBaseName) => {
// 		if (callLog.userRecordingId && callLog.agentRecordingId) {
// 			console.log("inside combineuseragentvideos", fileBaseName);
// 			// find the other file.
// 			let outputFile = `output_file_${callLog.ticketId}_${callLog._id}.webm`;
// 			const [agentFileName, userFileName] = parseFileBaseName(userType, fileBaseName, callLog);
//
// 			fs.readdir('./recordings-merged', (err, files) => {
// 				let userVideo, agentVideo;
// 				let fileListUser = files.filter(fn => fn.startsWith(userFileName));
// 				fileListUser = fileListUser.sort();
// 				userVideo = fileListUser[fileListUser.length - 1];
// 				let fileListAgent = files.filter(fn => fn.startsWith(agentFileName));
// 				fileListAgent = fileListAgent.sort();
// 				agentVideo = fileListAgent[fileListAgent.length - 1];
// 				console.log(agentVideo, userVideo, '1');
// 				//on finding both files, run
// 				console.log("running exec");
// 				if (agentVideo && userVideo) {
// 				exec(`ffmpeg -i ./recordings-merged/${agentVideo} -i ./recordings-merged/${userVideo
// 				} -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" ${outputFile}`,
// 					(stdout, res_multiple_combine, stderr) => {
// 						console.log(stdout, "stdout");
// 						console.log(res_multiple_combine)
// 						console.log("done with exec");
// 					});
// 				}
// 			});
// 		}
// 	};
// 	const mask = event.mask;
// 	let type = mask & Inotify.IN_ISDIR ? 'directory ' : 'file ';
// 	if (event.name) {
// 		type += ' ' + event.name + ' ';
// 	} else {
// 		type += ' ';
// 	}
//
// 	if (mask & Inotify.IN_CLOSE_WRITE) {
// 		// console.log(type + 'was accessed in recordings-merged');
// 		// console.log(type, type.split(' '));
// 		const fileBaseName = type.split(' ')[type.split(' ').length - 2];
// 		// console.log(fileBaseName, "fileBasename");
// 		if (fileBaseName.startsWith('user')) {
// 			console.log('USER');
// 			const userData = _.split(fileBaseName, '_');
// 			const botId = userData[2];
// 			const userSessionId = userData[5];
// 			const userHandleId = userData[6];
// 			// get call log based on this. if both available find the other file
// 			axios({
// 				baseURL: 'http://agents-service.services.svc.cluster.local:3000',
// 				url: '/janus/internal/getCallLogByUserSessionHandleId',
// 				params: {
// 					userSessionId,
// 					userHandleId,
// 					botId,
// 				}
// 			}).then((res) => {
// 				console.log(res.data, "calllog data user");
// 				//console.log("res.data", res.data.data, res.data.data[0]);
// 				return combineUserAgentVideos(res.data.data[0], 'user', fileBaseName);
// 			}).catch((e) => {
// 				console.log(e, "error")
// 			});
// 		} else if (fileBaseName.startsWith('agent')) {
// 			console.log('AGENT');
// 			const agentData = _.split(fileBaseName, '_');
// 			const botId = agentData[1];
// 			const agentSessionId = agentData[3];
// 			const agentHandleId = agentData[4];
// 			axios({
// 				baseURL: 'http://agents-service.services.svc.cluster.local:3000',
// 				url: '/janus/internal/getCallLogByAgentSessionHandleId',
// 				params: {
// 					agentSessionId,
// 					agentHandleId,
// 					botId,
// 				}
// 			}).then((res) => {
// 				console.log(res.data, "calllog data agent");
// 				//console.log("res.data", res.data, res.data.data[0]);
// 				return combineUserAgentVideos(res.data.data[0] || res.data, 'agent', fileBaseName);
// 			}).catch((e) => {
// 				console.log(e, "error")
// 			});
// 		}
// 	}
// }
//
// const callback = function (event) {
// 	const mask = event.mask;
// 	let type = mask & Inotify.IN_ISDIR ? 'directory ' : 'file ';
// 	if (event.name) {
// 		type += ' ' + event.name + ' ';
// 	} else {
// 		type += ' ';
// 	}
// 	// the purpose of this hell of 'if' statements is only illustrative.
//
// 	if (mask & Inotify.IN_CLOSE_WRITE) {
// 		// console.log(type + ' opened for writing was closed ');
// 		const fileTokens = _.split(type, '-');
// 		fileTokens[0] = (fileTokens[0].split(' ')[fileTokens[0].split(' ').length - 1]);
// 		fileTokens.pop();
// 		const fileBaseName = fileTokens.join('-');
// 		if (!avPairs[fileBaseName]) {
// 			avPairs[fileBaseName] = type;
// 		} else {
// 			exec(`janus-pp-rec ./recordings/${fileBaseName}-video.mjr ./recordings-pp/${fileBaseName}-video.webm`, (err, res_video, stderr) => {
// 				// console.log(res_video, "res_video");
// 				exec(`janus-pp-rec ./recordings/${fileBaseName}-audio.mjr ./recordings-pp/${fileBaseName}-audio.opus`, (err, res_audio, stderr) => {
// 					// console.log(res_audio, "res_audio");
// 					exec(`ffmpeg -i ./recordings-pp/${fileBaseName}-audio.opus -i ./recordings-pp/${fileBaseName}-video.webm  -c:v copy -c:a opus -strict experimental ./recordings-merged/${fileBaseName}.webm`, (err, res_merge, stderr) => {
// 						// console.log(res_merge, "res_merge");
// 						fs.readFile(`./recordings-merged/${fileBaseName}.webm`, (err, data) => {
// 							if (!err) {
// 								// bull - executor
// 								// console.log('got data from file', data);
// 								azureUpload.createSasUrl(data, `uploaded-${fileBaseName}.webm`).then((url) => {
// 									// console.log(url);
// 									// console.log('filebasename', fileBaseName, avPairs[fileBaseName]);
// 									if (fileBaseName.startsWith('user')) {
// 										 console.log('USER r');
// 										try {
// 											const userData = _.split(fileBaseName, '_');
// 											const ticketId = userData[1];
// 											const botId = userData[2];
// 											const uid = userData[3];
// 											const userSessionId = userData[5];
// 											const userHandleId = userData[6];
// 											if (ticketPairs[ticketId]) {
// 												ticketPairs[ticketId].push(fileBaseName);
// 											} else {
// 												ticketPairs[ticketId] = [fileBaseName];
// 											}
// 											axios({
// 												method: 'post',
// 												baseURL: 'http://agents-service.services.svc.cluster.local:3000',
// 												url: '/janus/internal/updateCallLogByUserSessionHandleId',
// 												data: {
// 													userSessionId,
// 													userHandleId,
// 													botId,
// 													url
// 												}
// 											}).then((res) => {
// 												console.log(res.data, "rec user calllog data");
// 											}).catch((e) => {
// 												console.log(e, "error")
// 											});
// 										} catch (e) {
// 											console.log(e, "err");
// 										}
// 									}
// 									if (fileBaseName.startsWith('agent')) {
// 										console.log('AGENT');
// 										try {
// 											const agentData = _.split(fileBaseName, '_');
// 											const botId = agentData[1];
// 											const agentId = agentData[2];
// 											const agentSessionId = agentData[3];
// 											const agentHandleId = agentData[4];
// 											axios({
// 												method: 'post',
// 												baseURL: 'http://agents-service.services.svc.cluster.local:3000',
// 												url: '/janus/internal/updateCallLogByAgentSessionHandleId',
// 												data: {
// 													agentSessionId,
// 													agentHandleId,
// 													botId,
// 													url
// 												}
// 											}).then((res) => {
// 												 console.log(res.data, "agent rec calllog data");
// 											}).catch((e) => {
// 												console.log(e, "error")
// 											});
// 										} catch (e) {
// 											console.log(e, "err");
// 										}
// 									}
// 								});
// 							}
// 						})
//
// 					});
// 				});
// 			});
// 		}
// 	}
// };
