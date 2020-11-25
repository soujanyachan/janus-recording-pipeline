const azure = require('azure-storage');
const blobService = azure.createBlobService("yellowmessenger", "/qnaZM6BMIwCaeRvhbhbrfzb6t3npUBZDxVMSDgdnJSozd7O3zdurau+yNUXf/FO7XdP1zhQQCnX9/jeyIg2ew==");
const streamifier = require('streamifier');
const mime = require('mime-types');
const createSasUrl = (buffer, fileName, expiryTime = 43200, bot, secure = false) => {
    return new Promise((resolve, reject) => {
        let stream = streamifier.createReadStream(buffer);
        let ext = fileName.lastIndexOf(".") !== -1 ? fileName.substring(fileName.lastIndexOf(".") + 1) : "";
		let name = randomString(12, "aA#") + (new Date().getTime()) + "." + ext;
		const filepath = `${bot}/${name}`;
        let mimeType = mime.lookup(name) ? mime.lookup(name) : 'text/plain';
        blobService.createBlockBlobFromStream('confidential', filepath, stream, buffer.length, {
            contentSettings: {contentType: mimeType, cacheControl: "private, max-age=31536000"},
            corsSettings: {allowOrigins: "*"}
        }, function (error) {
            console.log(error);
            if (error) {
                return reject(error);
            } else {
				if (secure) {
					return resolve(name);
				}

                let startDate = new Date();
                let expiryDate = new Date(startDate);
                expiryDate.setMinutes(startDate.getMinutes() + parseInt(expiryTime));
                let sharedAccessPolicy = {
                    AccessPolicy: {
                        Permissions: azure.BlobUtilities.SharedAccessPermissions.READ,
                        Start: startDate,
                        Expiry: expiryDate
                    }
                };
                let token = blobService.generateSharedAccessSignature("confidential", filepath, sharedAccessPolicy);
                let sasUrl = blobService.getUrl("confidential", filepath, token);
                return resolve(sasUrl);
            }
        });
    })
};

let randomString = function (length, chars) {
    let mask = '';
    if (chars.indexOf('a') > -1) mask += 'abcdefghijklmnopqrstuvwxyz';
    if (chars.indexOf('A') > -1) mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (chars.indexOf('#') > -1) mask += '0123456789';
    if (chars.indexOf('!') > -1) mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
    let result = '';
    for (let i = length; i > 0; --i) result += mask[Math.floor(Math.random() * mask.length)];
    return result;
};


const readFileFromBlob = (fileName, bot) => {
	return new Promise((resolve, reject)=>{
		if (!fileName) {
			return reject("Please provide file Name");
		}
	
		const filePath = `${bot}/${fileName}`;
		let bufferData;
		const readStream = blobService.createReadStream('confidential', filePath);

		readStream.on('data', function(data) {
			bufferData = data;
		});

		readStream.on('error', function(error) {
			return reject(error);
		});

		readStream.on('end', function() {
			if (!bufferData) {
				return reject("Data is empty");
			}

			return resolve(bufferData);
		});
	});
}

const deleteFileFromBlob = (fileName, bot) => {
	return new Promise((resolve, reject) => {
		if (!fileName) {
			return reject("Please provide file Name");
		}
	
		const filePath = `${bot}/${fileName}`;
		blobService.deleteBlob('confidential', filePath, function(error, response) {
			if (error) {
				return reject(error);
			}
			return resolve(response);
		});
	})
}

module.exports = {
	createSasUrl,
	readFileFromBlob,
	deleteFileFromBlob
};
