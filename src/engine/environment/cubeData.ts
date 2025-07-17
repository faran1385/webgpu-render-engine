export const cubePositions = new Float32Array([
    // Front face
    -1, -1,  1,
    1, -1,  1,
    1,  1,  1,
    -1,  1,  1,

    // Back face
    -1, -1, -1,
    -1,  1, -1,
    1,  1, -1,
    1, -1, -1,

    // Top face
    -1,  1, -1,
    -1,  1,  1,
    1,  1,  1,
    1,  1, -1,

    // Bottom face
    -1, -1, -1,
    1, -1, -1,
    1, -1,  1,
    -1, -1,  1,

    // Right face
    1, -1, -1,
    1,  1, -1,
    1,  1,  1,
    1, -1,  1,

    // Left face
    -1, -1, -1,
    -1, -1,  1,
    -1,  1,  1,
    -1,  1, -1,
]);

export const cubeIndices = new Uint16Array([
    // Front
    0, 1, 2,   0, 2, 3,
    // Back
    4, 5, 6,   4, 6, 7,
    // Top
    8, 9,10,   8,10,11,
    // Bottom
    12,13,14,  12,14,15,
    // Right
    16,17,18,  16,18,19,
    // Left
    20,21,22,  20,22,23,
]);
