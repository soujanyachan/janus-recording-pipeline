const axios = require('axios');
const {exec, execSync} = require('child_process');
const express = require('express');
const _ = require('lodash');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const azureUpload = require('./upload.js');
const bodyParser = require('body-parser');

const ffmpegCommand = ffmpeg();

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
                console.log(agentFileAudio, agentFileVideo);
                // convert agent audio to opus
                console.log('1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111')
                const agentAudioResult = await execSync(`janus-pp-rec /recording-data/${agentFileAudio} /recording-pp/${
                    agentFileAudio}.opus`);
                // convert agent video to webm
                console.log('22222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222')
                const agentVideoResult = await execSync(`janus-pp-rec /recording-data/${agentFileVideo} /recording-pp/${
                    agentFileVideo}.webm`);
                console.log(agentAudioResult.toString());
                console.log(agentVideoResult.toString());
                // merge agent
                console.log('3333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333')
                const agentVideoFinalResult = await execSync(`ffmpeg -i /recording-pp/${agentFileAudio}.opus -i /recording-pp/${
                    agentFileVideo}.webm  -c:v copy -c:a opus -strict experimental /recording-merged/${agentFileName}.webm`);
                console.log(agentVideoFinalResult.toString());

                // let userFileAudio, userFileVideo;
                // userFiles.map((x) => {
                //     if (x.endsWith('audio.mjr')) userFileAudio = x;
                //     else if (x.endsWith('video.mjr')) userFileVideo = x;
                // });
                // console.log(userFileAudio, userFileVideo);
                // // convert user audio to opus
                // const userAudioResult = await execSync(`janus-pp-rec /recording-data/${userFileAudio} /recording-pp/${userFileAudio}.opus`);
                // // convert user video to webm
                // const userVideoResult = await execSync(`janus-pp-rec /recording-data/${userFileVideo} /recording-pp/${userFileVideo}.webm`);
                // console.log(userAudioResult.toString());
                // console.log(userVideoResult.toString());
                // // merge user
                // const userVideoFinalResult = await execSync(`ffmpeg -i /recording-pp/${userFileAudio}.opus -i /recordings-pp/${
                //     userFileVideo}.webm  -c:v copy -c:a opus -strict experimental /recording-merged/${userFileName}.webm`);
                // console.log(userVideoFinalResult.toString());
                // merge the two videos
                res.send({
                    success: true,
                    message: 'Merged the videos',
                    data: {
                        mergedUrl: '',
                        agentVideoUrl: '',
                        userVideoUrl: '',
                    }
                })
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

// find agent file name and user file name and return failure if file size is 0
// try using chokidar for this

app.post('/process-recordings', (req, res) => {
    const callLog = req.body.callLog;
	const [agentFileName, userFileName] = createFileBaseNameFromCallLog(callLog);
	// else merge audio and video of agent and user
	// merge videos of agent and user

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
// 			//TODO: need to create the recordings-pp and recordings-merged dirs if not available
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
// const home_dir = {
// 	path: './recordings',
// 	watch_for: Inotify.IN_ALL_EVENTS,
// 	callback: callback
// };
//
// const home_watch_descriptor = inotify.addWatch(home_dir);
//
// const home_dir_2 = {
// 	path: './recordings-merged',
// 	watch_for: Inotify.IN_CLOSE_WRITE,
// 	callback: (event) => setTimeout(() => callback2(event), 5000)
// };
//
// const home_watch_descriptor_2 = inotify.addWatch(home_dir_2);
//
