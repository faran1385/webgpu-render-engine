import {mat3, mat4, vec3} from "gl-matrix";
// @ts-ignore
import Stats from 'stats-js';
import {MaterialInstance} from "../engine/Material/Material.ts"
import {TypedArray} from "@gltf-transform/core";
import {Primitive, PrimitiveHashes} from "../engine/primitive/Primitive.ts";
import {BaseLayer} from "../layers/baseLayer.ts";
import {ComputeManager} from "../engine/computation/computeManager.ts";
import {StandardMaterial} from "../engine/Material/StandardMaterial.ts";

export function createGPUBuffer(
    device: GPUDevice,
    data: TypedArray,
    usage: GPUBufferUsageFlags,
    label: string,
    sizeInBytes: number | undefined = undefined
): GPUBuffer {

    const buffer = device.createBuffer({
        size: sizeInBytes ?? (data as TypedArray).byteLength,
        label,
        usage: GPUBufferUsage.COPY_DST | usage,
    });
    device.queue.writeBuffer(buffer, 0, data as TypedArray);
    return buffer;
}


/////////////////////
export function makePrimitiveKey(id: number, side: "back" | "front" | "none") {
    return `${id}_${side}`
}

export function unpackPrimitiveKey(key: string): { id: number; side: "front" | "back" | "none" } {
    const [idStr, side] = key.split("_");

    const id = parseInt(idStr, 10);

    return {id, side: side as "front" | "back" | "none"};
}


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
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
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
    const baseLayer = new BaseLayer(device, canvas, ctx);
    await baseLayer.initialize()
    return {ctx, device, canvas, baseLayer}
}

export const updateBuffer = (device: GPUDevice, buffer: GPUBuffer, data: TypedArray | mat4 | vec3) => {
    device.queue.writeBuffer(buffer, 0, data as TypedArray)
}


let nextID = 0;

export function generateID() {
    return nextID++;
}


export function isLightDependentMaterial(material: MaterialInstance) {
    return material instanceof StandardMaterial
}

export function hexToVec3(hex: string): [number, number, number] {
    hex = hex.replace("#", "");

    // Parse hex values to integers
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return [r / 255.0, g / 255.0, b / 255.0];
}


export async function hashAndCreateRenderSetup(
    computeManager: ComputeManager,
    materials: MaterialInstance[],
    primitives: Primitive[],
    isBindGroupLayoutAlreadySet: undefined | true = undefined
) {
    const geometryLayoutHashes = BaseLayer.gpuCache.createGeometryLayoutHashes(primitives)
    if (!isBindGroupLayoutAlreadySet) {
        materials.forEach(mat => {
            const hash = BaseLayer.hasher.hashBindGroupLayout(mat.descriptor.layoutEntries)
            BaseLayer.gpuCache.appendBindGroupLayout(mat.descriptor.layoutEntries,
                hash,
                Array.from(mat.primitives)
            )
            mat.setHashes("bindGroupLayout", hash)
            mat.bindGroupLayout = (BaseLayer.gpuCache.getResource(hash, "bindGroupLayoutMap") as any).layout as any
        })
    }
    await BaseLayer.gpuCache.createMaterialHashes(materials)
    materials.forEach(mat => mat.compileShader())
    const shaderCodesHashes = BaseLayer.gpuCache.createShaderCodeHashes(primitives)
    const pipelineLayoutsHashes = BaseLayer.gpuCache.createPipelineLayoutHashes(primitives, geometryLayoutHashes)
    const pipelineHashes = BaseLayer.gpuCache.createPipelineHashes(shaderCodesHashes, pipelineLayoutsHashes)
    const geometryBindGroupMaps = BaseLayer.gpuCache.createGeometryBindGroupMaps(primitives)
    const primitiveMap = new Map<number, Primitive>();
    pipelineHashes.forEach((pipelineHash, key) => {
        const {side, id: primitiveId} = unpackPrimitiveKey(key)
        const pipelineLayout = pipelineLayoutsHashes.get(primitiveId)!
        primitiveMap.set(primitiveId, pipelineLayout.primitive)


        const shaderCodeHash = shaderCodesHashes.get(primitiveId)!
        if (!pipelineLayout) throw new Error("pipelineLayout is not set")
        const primitive = pipelineLayout?.primitive!

        const primitiveHashes: PrimitiveHashes = {
            shader: {
                vertex: shaderCodeHash[1],
                fragment: shaderCodeHash[0],
            },
            pipeline: pipelineHash,
            pipelineLayout: pipelineLayout.hash,
        }

        primitive.setPrimitiveHashes(primitiveHashes, side!)
    })

    primitiveMap.forEach((primitive) => {
        const geometryEntries = geometryBindGroupMaps.get(primitive.id)
        const geometryLayoutHash = geometryLayoutHashes.get(primitive.id)!
        if (!geometryEntries) throw new Error(`Primitive with id ${primitive.id} has no bindGroup descriptor set on geometry`)
        let {layout: geometryBindGroupLayout} = BaseLayer.gpuCache.getResource(geometryLayoutHash, "bindGroupLayoutMap") as any

        primitive.geometry.bindGroup = BaseLayer.device.createBindGroup({
            entries: geometryEntries,
            label: `${primitive.sceneObject.name ?? ""} geometry bindGroup`,
            layout: geometryBindGroupLayout
        })
        primitive.setLodRanges(primitive.geometry.lodRanges)
        primitive.setIndexData(primitive.geometry.indices)
        primitive.vertexBufferDescriptors.forEach((item) => {
            const dataArray = primitive.geometry.dataList.get(item.name)?.array;
            if (!dataArray) throw new Error(`${item.name} not found in geometry datalist of primitive with id ${primitive.id}`)
            primitive.setVertexBuffers(createGPUBuffer(BaseLayer.device, dataArray, GPUBufferUsage.VERTEX, `${primitive.sceneObject.name}  ${item.name}`))
        })

        primitive.modelMatrix = (primitive.sceneObject).worldMatrix;
        primitive.normalMatrix = (primitive.sceneObject).normalMatrix;

        if (primitive.geometry.indices) {
            computeManager.setIndex(primitive.sceneObject)
        }
        computeManager.setIndirect(primitive.sceneObject)
        primitive.sides.forEach((side) => {
            primitive.setPipeline(side)
        })
    })
}

export const downsampleWGSL = `
struct Params {
    flipY: u32
};

@group(0) @binding(0) var prevMip : texture_2d<f32>;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var<uniform> params : Params;

// 4x4 Gaussian kernel (sigma ~ 1.0), normalized
const KERNEL : array<array<f32,4>,4> = array<array<f32,4>,4>(
    array<f32,4>(0.018082, 0.049153, 0.049153, 0.018082),
    array<f32,4>(0.049153, 0.133612, 0.133612, 0.049153),
    array<f32,4>(0.049153, 0.133612, 0.133612, 0.049153),
    array<f32,4>(0.018082, 0.049153, 0.049153, 0.018082)
);

struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>
};

@vertex
fn vs_main(@builtin(vertex_index) vIndex : u32) -> VSOut {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), // triangle 1
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), // triangle 2
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0)
    );

    var uv = array<vec2<f32>,6>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );

    var out : VSOut;
    out.position = vec4<f32>(pos[vIndex], 0.0, 1.0);
    out.uv = uv[vIndex];
    return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    // Obtain previous mip texel size
    let dims = vec2<f32>(textureDimensions(prevMip, 0));
    let texel = 1.0 / dims;

    // Centered offsets for 4x4 kernel: positions = (-1.5, -0.5, 0.5, 1.5) * texel
    let offX = array<f32,4>(-1.5, -0.5, 0.5, 1.5);
    let offY = array<f32,4>(-1.5, -0.5, 0.5, 1.5);

    // flipY if requested: our vertex uv layout uses top-left UVs for sampling (see vs_main)
    var baseUV = in.uv;
    if (params.flipY == 1u) {
        baseUV.y = 1.0 - baseUV.y;
    }

    var sum : vec4<f32> = vec4<f32>(0.0);
    for (var j: i32 = 0; j < 4; j = j + 1) {
        for (var i: i32 = 0; i < 4; i = i + 1) {
            let offset = vec2<f32>(offX[i] * texel.x, offY[j] * texel.y);
            let sampleUV = baseUV + offset;
            let c = textureSample(prevMip, samp, sampleUV);
            sum = sum + c * KERNEL[j][i];
        }
    }

    return sum;
}
`;

export async function createDownsamplePipeline(device: GPUDevice, format: GPUTextureFormat) {
    const shaderModule = device.createShaderModule({ code: downsampleWGSL });


    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
    });


    const sampler = device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
    });


// Uniform buffer for flipY (4 bytes) -> allocate 16 bytes (aligned)
    const uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });


    return { pipeline, sampler, uniformBuffer };
}

export function renderDownsampleMip(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    pipelineObj: { pipeline: GPURenderPipeline; sampler: GPUSampler; uniformBuffer: GPUBuffer },
    srcView: GPUTextureView,
    dstView: GPUTextureView,
    flipY: boolean
) {
    const { pipeline, sampler, uniformBuffer } = pipelineObj;


// Create bind group for this pass
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: srcView },
            { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: uniformBuffer } }
        ]
    });


// Update uniform (flipY as u32)
    const flip = flipY ? 1 : 0;
    const uniformArray = new Uint32Array([flip, 0, 0, 0]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray.buffer, uniformArray.byteOffset, uniformArray.byteLength);


    const passDesc: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: dstView,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 0 }
            }
        ]
    };


    const pass = commandEncoder.beginRenderPass(passDesc);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
// Draw full-screen triangle-list (6 verts)
    pass.draw(6, 1, 0, 0);
    pass.end();
}