// xBN1t17SXcKY
const axios = require('axios');
const {exec} = require('child_process');
const _ = require('lodash');
const fs = require('fs');
const azureUpload = require('./upload.js');
var Inotify = require('inotify').Inotify;
var inotify = new Inotify(); //persistent by default, new Inotify(false) //no persistent

const avPairs = {};
const ticketPairs = {};

const callback2 = function (event) {
	console.log(event, "event");
	const parseFileBaseName = (userType, fileBaseName) => {
		let agentFileName, userFileName;
		if (userType === 'agent') {
			agentFileName = fileBaseName;
			console.log("inside agent");
			const agentData = _.split(fileBaseName, '_');
			const botId = agentData[1];
			const agentId = agentData[2];
			const agentSessionId = agentData[3];
			const agentHandleId = agentData[4];
			userFileName = `user_${callLog.ticketId}_${botId}_${callLog.uid}_${callLog.userSessionId}_${callLog.userHandleId}`;
			// construct the other file name using call log and find it in the directory
			console.log(userFileName, "userFileName");
		} else if (userType === 'user') {
			userFileName = fileBaseName;
			console.log("inside user");
			const userData = _.split(fileBaseName, '_');
			const ticketId = userData[1];
			const botId = userData[2];
			const uid = userData[3];
			const userSessionId = userData[5];
			const userHandleId = userData[6];
			agentFileName = `agent_${botId}_${callLog.agentId}_${callLog.agentSessionId}_${callLog.agentHandleId}`;
			console.log(agentFileName, "agentFileName");
		}
		return [agentFileName, userFileName];
	}

	const combineUserAgentVideos = (callLog, userType, fileBaseName) => {
		if (callLog.userRecordingId && callLog.agentRecordingId) {
			console.log("inside combineuseragentvideos", fileBaseName);
			// find the other file.
			let outputFile = `output_file_${callLog.ticketId}_${callLog._id}`;
			const [agentFileName, userFileName] = parseFileBaseName(userType, fileBaseName);

			fs.readdir('./recordings-merged', (err, files) => {
				let userVideo, agentVideo;
				let fileListUser = files.filter(fn => fn.startsWith(userFileName));
				console.log(fileListUser, "filelist user");
				fileListUser = fileListUser.sort();
				userVideo = fileListUser[fileListUser.length - 1];
				let fileListAgent = files.filter(fn => fn.startsWith(agentFileName));
				console.log(fileListAgent, "fileList");
				fileListAgent = fileListAgent.sort();
				agentVideo = fileListAgent[fileListAgent.length - 1];
				console.log(agentVideo, userVideo, '1');
				//on finding both files, run
				exec(`ffmpeg -i ${agentVideo} -i ${userVideo
				} -filter_complex "[0:v]scale=480:640,setsar=1[l];[1:v]scale=480:640,setsar=1[r];[l][r]hstack;[0][1]amix" ${outputFile}`,
					(stdout, res_multiple_combine, stderr) => {
						console.log(res_multiple_combine)
					});
			});
		}
	};
	var mask = event.mask;
	var type = mask & Inotify.IN_ISDIR ? 'directory ' : 'file ';
	if (event.name) {
		type += ' ' + event.name + ' ';
	} else {
		type += ' ';
	}

	if (mask & Inotify.IN_CLOSE_WRITE) {
		// console.log(type + 'was accessed in recordings-merged');
		// console.log(type, type.split(' '));
		const fileBaseName = type.split(' ')[type.split(' ').length - 2];
		// console.log(fileBaseName, "fileBasename");
		if (fileBaseName.startsWith('user')) {
			console.log('USER');
			const userData = _.split(fileBaseName, '_');
			const botId = userData[2];
			const userSessionId = userData[5];
			const userHandleId = userData[6];
			// get call log based on this. if both available find the other file
			axios({
				baseURL: 'http://agents-service.services.svc.cluster.local:3000',
				url: '/janus/internal/getCallLogByUserSessionHandleId',
				params: {
					userSessionId,
					userHandleId,
					botId,
				}
			}).then((res) => {
				//console.log(res.data, "calllog data user");
				//console.log("res.data", res.data.data, res.data.data[0]);
				return combineUserAgentVideos(res.data.data[0], 'user', fileBaseName);
			}).catch((e) => {
				console.log(e, "error")
			});
		} else if (fileBaseName.startsWith('agent')) {
			console.log('AGENT');
			const agentData = _.split(fileBaseName, '_');
			const botId = agentData[1];
			const agentSessionId = agentData[3];
			const agentHandleId = agentData[4];
			axios({
				baseURL: 'http://agents-service.services.svc.cluster.local:3000',
				url: '/janus/internal/getCallLogByAgentSessionHandleId',
				params: {
					agentSessionId,
					agentHandleId,
					botId,
				}
			}).then((res) => {
				//console.log(res.data, "calllog data agent");
				//console.log("res.data", res.data, res.data.data[0]);
				return combineUserAgentVideos(res.data.data[0] || res.data, 'agent', fileBaseName);
			}).catch((e) => {
				console.log(e, "error")
			});
		}
	}
}

var callback = function (event) {
	var mask = event.mask;
	var type = mask & Inotify.IN_ISDIR ? 'directory ' : 'file ';
	if (event.name) {
		type += ' ' + event.name + ' ';
	} else {
		type += ' ';
	}
	// the purpose of this hell of 'if' statements is only illustrative.

	if (mask & Inotify.IN_CLOSE_WRITE) {
		// console.log(type + ' opened for writing was closed ');
		const fileTokens = _.split(type, '-');
		fileTokens[0] = (fileTokens[0].split(' ')[fileTokens[0].split(' ').length - 1]);
		fileTokens.pop();
		const fileBaseName = fileTokens.join('-');
		if (!avPairs[fileBaseName]) {
			avPairs[fileBaseName] = type;
		} else {
			//TODO: need to create the recordings-pp and recordings-merged dirs if not available
			exec(`janus-pp-rec ./recordings/${fileBaseName}-video.mjr ./recordings-pp/${fileBaseName}-video.webm`, (err, res_video, stderr) => {
				// console.log(res_video, "res_video");
				exec(`janus-pp-rec ./recordings/${fileBaseName}-audio.mjr ./recordings-pp/${fileBaseName}-audio.opus`, (err, res_audio, stderr) => {
					// console.log(res_audio, "res_audio");
					exec(`ffmpeg -i ./recordings-pp/${fileBaseName}-audio.opus -i ./recordings-pp/${fileBaseName}-video.webm  -c:v copy -c:a opus -strict experimental ./recordings-merged/${fileBaseName}.webm`, (err, res_merge, stderr) => {
						// console.log(res_merge, "res_merge");
						fs.readFile(`./recordings-merged/${fileBaseName}.webm`, (err, data) => {
							if (!err) {
								// console.log('got data from file', data);
								azureUpload.createSasUrl(data, `uploaded-${fileBaseName}.webm`).then((url) => {
									// console.log(url);
									// console.log('filebasename', fileBaseName, avPairs[fileBaseName]);
									if (fileBaseName.startsWith('user')) {
										// console.log('USER');
										try {
											const userData = _.split(fileBaseName, '_');
											const ticketId = userData[1];
											const botId = userData[2];
											const uid = userData[3];
											const userSessionId = userData[5];
											const userHandleId = userData[6];
											if (ticketPairs[ticketId]) {
												ticketPairs[ticketId].push(fileBaseName);
											} else {
												ticketPairs[ticketId] = [fileBaseName];
											}
											axios({
												method: 'post',
												baseURL: 'http://agents-service.services.svc.cluster.local:3000',
												url: '/janus/internal/updateCallLogByUserSessionHandleId',
												data: {
													userSessionId,
													userHandleId,
													botId,
													url
												}
											}).then((res) => {
												// console.log(res.data, "calllog data");
											}).catch((e) => {
												console.log(e, "error")
											});
										} catch (e) {
											console.log(e, "err");
										}
									}
									if (fileBaseName.startsWith('agent')) {
										// console.log('AGENT');
										try {
											const agentData = _.split(fileBaseName, '_');
											const botId = agentData[1];
											const agentId = agentData[2];
											const agentSessionId = agentData[3];
											const agentHandleId = agentData[4];
											axios({
												method: 'post',
												baseURL: 'http://agents-service.services.svc.cluster.local:3000',
												url: '/janus/internal/updateCallLogByAgentSessionHandleId',
												data: {
													agentSessionId,
													agentHandleId,
													botId,
													url
												}
											}).then((res) => {
												// console.log(res.data, "calllog data");
											}).catch((e) => {
												console.log(e, "error")
											});
										} catch (e) {
											console.log(e, "err");
										}
									}
								});
							}
						})

					});
				});
			});
		}
	}
};
var home_dir = {
	path: './recordings',
	watch_for: Inotify.IN_ALL_EVENTS,
	callback: callback
};

var home_watch_descriptor = inotify.addWatch(home_dir);

var home_dir_2 = {
	path: './recordings-merged',
	watch_for: Inotify.IN_CLOSE_WRITE,
	callback: (event) => setTimeout(() => callback2(event), 5000)
};

var home_watch_descriptor_2 = inotify.addWatch(home_dir_2);

