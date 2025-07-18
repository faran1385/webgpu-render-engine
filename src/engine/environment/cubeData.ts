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

export const cubemapViewMatricesInverted = [
    mat4.lookAt(
        mat4.create(),
        vec3.fromValues(0.0, 0.0, 0.0),
        vec3.fromValues(-1.0, 0.0, 0.0),
        vec3.fromValues(0.0, 1.0, 0.0),
    ),
    mat4.lookAt(
        mat4.create(),
        vec3.fromValues(0.0, 0.0, 0.0),
        vec3.fromValues(1.0, 0.0, 0.0),
        vec3.fromValues(0.0, 1.0, 0.0),
    ),
    mat4.lookAt(
        mat4.create(),
        vec3.fromValues(0.0, 0.0, 0.0),
        vec3.fromValues(0.0, 1.0, 0.0),
        vec3.fromValues(0.0, 0.0, -1.0),
    ),
    mat4.lookAt(
        mat4.create(),
        vec3.fromValues(0.0, 0.0, 0.0),
        vec3.fromValues(0.0, -1.0, 0.0),
        vec3.fromValues(0.0, 0.0, 1.0),
    ),
    mat4.lookAt(
        mat4.create(),
        vec3.fromValues(0.0, 0.0, 0.0),
        vec3.fromValues(0.0, 0.0, 1.0),
        vec3.fromValues(0.0, 1.0, 0.0),
    ),
    mat4.lookAt(
        mat4.create(),
        vec3.fromValues(0.0, 0.0, 0.0),
        vec3.fromValues(0.0, 0.0, -1.0),
        vec3.fromValues(0.0, 1.0, 0.0),
    ),
];

export const cubemapVertexShader = /* wgsl */ `
struct VSOut {
  @builtin(position) Position: vec4f,
  @location(0) worldPosition: vec4f,
};

struct Uniforms {
  modelViewProjectionMatrix: mat4x4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(@location(0) position: vec3f) -> VSOut {
  var output: VSOut;
  let worldPosition: vec4f=vec4f(position,1.);
  output.Position = uniforms.modelViewProjectionMatrix * worldPosition;
  output.worldPosition = worldPosition;
  return output;
}
`;
