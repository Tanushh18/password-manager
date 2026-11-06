const mongoose = require("mongoose");

// The 3D model of the house that the owner imported (a .glb file). One per account. The file is kept as it came; the website reads it back
// and matches the names of its parts (meshes) to the room names.
const homeModel3dSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    name: { type: String, default: "house.glb", maxlength: 80 },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
    at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.HomeModel3d || mongoose.model("HomeModel3d", homeModel3dSchema);
