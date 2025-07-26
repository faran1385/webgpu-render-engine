import {mat4, vec3} from "gl-matrix";

export const cubePositions = new Float32Array([
    // Front face
    -1, -1, 1,
    1, -1, 1,
    1, 1, 1,
    -1, 1, 1,

    // Back face
    -1, -1, -1,
    -1, 1, -1,
    1, 1, -1,
    1, -1, -1,

    // Top face
    -1, 1, -1,
    -1, 1, 1,
    1, 1, 1,
    1, 1, -1,

    // Bottom face
    -1, -1, -1,
    1, -1, -1,
    1, -1, 1,
    -1, -1, 1,

    // Right face
    1, -1, -1,
    1, 1, -1,
    1, 1, 1,
    1, -1, 1,

    // Left face
    -1, -1, -1,
    -1, -1, 1,
    -1, 1, 1,
    -1, 1, -1,
]);

export const cubeIndices = new Uint16Array([
    // Front
    0, 1, 2, 0, 2, 3,
    // Back
    4, 5, 6, 4, 6, 7,
    // Top
    8, 9, 10, 8, 10, 11,
    // Bottom
    12, 13, 14, 12, 14, 15,
    // Right
    16, 17, 18, 16, 18, 19,
    // Left
    20, 21, 22, 20, 22, 23,
]);


const eye = vec3.fromValues(0, 0, 0)

const directions = [
    {target: vec3.fromValues(1, 0, 0), up: vec3.fromValues(0, -1, 0)}, // +X
    {target: vec3.fromValues(-1, 0, 0), up: vec3.fromValues(0, -1, 0)}, // -X
    {target: vec3.fromValues(0, -1, 0), up: vec3.fromValues(0, 0, -1)}, // -Y
    {target: vec3.fromValues(0, 1, 0), up: vec3.fromValues(0, 0, 1)},   // +Y
    {target: vec3.fromValues(0, 0, 1), up: vec3.fromValues(0, -1, 0)},  // +Z
    {target: vec3.fromValues(0, 0, -1), up: vec3.fromValues(0, -1, 0)}, // -Z
]

export const views = directions.map(({target, up}) => {
    const view = mat4.create()
    mat4.lookAt(view, eye, target, up)
    return view
})




export const cubemapVertexShader = /* wgsl */ `
struct VSOut {
  @builtin(position) Position: vec4f,
  @location(0) worldPosition: vec3f,
};

struct Uniforms {
  modelViewProjectionMatrix: mat4x4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(@location(0) position: vec3f) -> VSOut {
  var output: VSOut;
  let worldPosition = vec4f(position,1.);
  output.Position = uniforms.modelViewProjectionMatrix * worldPosition;
  output.worldPosition = position;
  return output;
}
`;