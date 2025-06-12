import {mat3, mat4, vec3} from "gl-matrix";
// @ts-ignore
import Stats from 'stats-js';
import {TypedArray, vec2} from "@gltf-transform/core";

export function createGPUBuffer(
    device: GPUDevice,
    data: TypedArray,
    usage: GPUBufferUsageFlags,
    label: string
): GPUBuffer {

    const buffer = device.createBuffer({
        size: (data as TypedArray).byteLength,
        label,
        usage: GPUBufferUsage.COPY_DST | usage,
    });
    device.queue.writeBuffer(buffer, 0, data as TypedArray);
    return buffer;
}


/////////////////////

///////////////////////


/**
 * Computes a normal matrix padded as a 3x4 Float32Array (for uniform buffers).
 * @param modelMatrix A 4x4 model matrix (mat4)
 * @returns A Float32Array of length 12 (3 rows × 4 columns)
 */
export function computeNormalMatrix3x4(modelMatrix: mat4): Float32Array {
    const normalMat3 = mat3.create();
    mat3.fromMat4(normalMat3, modelMatrix);      // extract top-left 3x3
    mat3.invert(normalMat3, normalMat3);         // invert
    mat3.transpose(normalMat3, normalMat3);      // transpose

    const normalMat3x4 = new Float32Array(12);   // 3 rows * 4 floats (aligned)

    // Copy 3x3 into 3x4 with 4th column = 0 (padding)
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            normalMat3x4[row * 4 + col] = normalMat3[col * 3 + row]; // transpose to row-major
        }
        normalMat3x4[row * 4 + 3] = 0; // padding
    }

    return normalMat3x4;
}


export const getStats = () => {
    const stats = new Stats();
    stats.showPanel(0);
    stats.dom.style.left = "10px"
    stats.dom.style.top = "10px"
    document.body.appendChild(stats.dom);
    return stats
}


export const initWebGPU = async () => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('webgpu') as GPUCanvasContext;


    const adapter = await navigator.gpu.requestAdapter({});
    if (!adapter) {
        throw new Error('No adapter supplied!');
    }
    console.log(adapter)
    const device = await adapter.requestDevice({
        requiredFeatures: ["timestamp-query", 'bgra8unorm-storage', 'float32-filterable']
    });
    if (!device) {
        throw new Error('No device supplied!');
    }

    ctx.configure({
        device,
        alphaMode: "opaque",
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    return {ctx, device, canvas}
}

export const updateBuffer = (device: GPUDevice, buffer: GPUBuffer, data: TypedArray | mat4 | vec3) => {
    device.queue.writeBuffer(buffer, 0, data as TypedArray)
}

export const getTextureFromData = async (device: GPUDevice, size: vec2 | vec3, data: TypedArray) => {

    const imageBitmap = await createImageBitmap(new Blob([data]));
    const texture = device.createTexture({
        size: [...size],
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        textureBindingViewDimension: "2d",
        format: "bgra8unorm",
    })
    device.queue.copyExternalImageToTexture(
        {source: imageBitmap},
        {texture: texture},
        size
    );


    return texture;
}

export const convertAlphaMode = (mode: "BLEND" | "MASK" | "OPAQUE") => {
    return mode === "OPAQUE" ? 0 : mode === "BLEND" ? 1 : 2
}

let nextID = 0;
export function generateID() {
    return nextID++;
}
