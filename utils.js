
const CRYPTO = require("crypto");


exports.generateId = function () {
    return parseInt(CRYPTO.randomBytes(8).toString('hex'), 16).toString(36) + "-" + Date.now().toString(36);
}
