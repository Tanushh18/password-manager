const VIDEO = ["mp4", "mkv", "avi", "mov", "m4v", "webm", "ts", "mpg", "mpeg", "wmv", "flv", "3gp"];
const EXTRA = ["srt", "vtt", "ass"];
const ext = (name) => { const i = String(name).lastIndexOf("."); return i < 0 ? "" : String(name).slice(i + 1).toLowerCase(); };
/** A video or a subtitle: the only things the TV will copy. */
const wantedVideo = (name) => VIDEO.includes(ext(name)) || EXTRA.includes(ext(name));
module.exports = { wantedVideo, VIDEO, EXTRA };
