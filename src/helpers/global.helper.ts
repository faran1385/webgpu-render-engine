import {mat3, mat4, vec3} from "gl-matrix";
// @ts-ignore
import Stats from 'stats-js';
import {Material as MaterialClass} from "../engine/Material/Material.ts"
import {Material, TypedArray, vec2} from "@gltf-transform/core";
import {Clearcoat, Specular, Transmission} from "@gltf-transform/extensions";
import {
    PBRBindPoint,
    PBRFactorsStartPoint,
    RenderFlag
} from "../engine/GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {TextureData} from "../engine/Material/Material.ts";
import {Primitive, PrimitiveHashes} from "../engine/primitive/Primitive.ts";
import {PipelineEntry} from "../renderers/modelRenderer.ts";
import {GPUCache} from "../engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {BaseLayer} from "../layers/baseLayer.ts";
import {ComputeManager} from "../engine/computation/computeManager.ts";

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

    return {ctx, device, canvas}
}

export const updateBuffer = (device: GPUDevice, buffer: GPUBuffer, data: TypedArray | mat4 | vec3) => {
    device.queue.writeBuffer(buffer, 0, data as TypedArray)
}

export const getTextureFromData = async (device: GPUDevice, size: vec2 | vec3, data: TypedArray, format: GPUTextureFormat) => {

    const imageBitmap = await createImageBitmap(new Blob([data]));
    const texture = device.createTexture({
        size: [...size],
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        textureBindingViewDimension: "2d",
        format: format,
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

export function extractExtensions(material: Material) {
    const extensionMap = new Map<RenderFlag, {
        texture: {
            data: TypedArray,
            size: vec2
        } | null,
        factor: number | number[],
        pbrBindPoint: number,
        pbrFactorStartPoint: number,
    }>();

    material.listExtensions().forEach((extension) => {
        if (extension instanceof Specular) {
            const specularTexture = extension.getSpecularTexture();
            const specularColorTexture = extension.getSpecularColorTexture();

            extensionMap.set(RenderFlag.SPECULAR, {
                texture: specularTexture ? {
                    size: specularTexture.getSize()!,
                    data: specularTexture.getImage()!
                } : null,
                factor: extension.getSpecularFactor(),
                pbrBindPoint: PBRBindPoint.SPECULAR,
                pbrFactorStartPoint: PBRFactorsStartPoint.SPECULAR,
            })

            extensionMap.set(RenderFlag.SPECULAR_COLOR, {
                texture: specularColorTexture ? {
                    size: specularColorTexture.getSize()!,
                    data: specularColorTexture.getImage()!
                } : null,
                factor: extension.getSpecularColorFactor(),
                pbrBindPoint: PBRBindPoint.SPECULAR_COLOR,
                pbrFactorStartPoint: PBRFactorsStartPoint.SPECULAR_COLOR,
            })
        } else if (extension instanceof Transmission) {
            const transmissionTexture = extension.getTransmissionTexture();

            extensionMap.set(RenderFlag.TRANSMISSION, {
                texture: transmissionTexture ? {
                    size: transmissionTexture.getSize()!,
                    data: transmissionTexture.getImage()!
                } : null,
                factor: extension.getTransmissionFactor(),
                pbrBindPoint: PBRBindPoint.TRANSMISSION,
                pbrFactorStartPoint: PBRFactorsStartPoint.TRANSMISSION,

            })

        } else if (extension instanceof Clearcoat) {
            const clearcoatTexture = extension.getClearcoatTexture();

            extensionMap.set(RenderFlag.CLEARCOAT, {
                texture: clearcoatTexture ? {
                    size: clearcoatTexture.getSize()!,
                    data: clearcoatTexture.getImage()!
                } : null,
                factor: extension.getClearcoatFactor(),
                pbrBindPoint: PBRBindPoint.CLEARCOAT,
                pbrFactorStartPoint: PBRFactorsStartPoint.CLEARCOAT,
            })


            const clearcoatRoughnessTexture = extension.getClearcoatRoughnessTexture();

            extensionMap.set(RenderFlag.CLEARCOAT_ROUGHNESS, {
                texture: clearcoatRoughnessTexture ? {
                    size: clearcoatRoughnessTexture.getSize()!,
                    data: clearcoatRoughnessTexture.getImage()!
                } : null,
                factor: extension.getClearcoatRoughnessFactor(),
                pbrBindPoint: PBRBindPoint.CLEARCOAT_ROUGHNESS,
                pbrFactorStartPoint: PBRFactorsStartPoint.CLEARCOAT_ROUGHNESS,
            })

            const clearcoatNormalTexture = extension.getClearcoatNormalTexture();

            extensionMap.set(RenderFlag.CLEARCOAT_NORMAL, {
                texture: clearcoatNormalTexture ? {
                    size: clearcoatNormalTexture.getSize()!,
                    data: clearcoatNormalTexture.getImage()!
                } : null,
                factor: extension.getClearcoatNormalScale(),
                pbrBindPoint: PBRBindPoint.CLEARCOAT_NORMAL,
                pbrFactorStartPoint: PBRFactorsStartPoint.CLEARCOAT_NORMAL,
            })
        }
    })

    return extensionMap;
}


export function needsSampler(map: Map<RenderFlag, TextureData>) {
    return Array.from(map).some(([_, value]) => value.texture)
}

export function extractMaterial(material: Material) {

    const dataMap = new Map<RenderFlag, TextureData>()

    const baseColor = material.getBaseColorTexture();
    const baseColorData = {
        texture: baseColor
            ? {
                data: baseColor.getImage() as TypedArray,
                size: baseColor.getSize() as [number, number]
            }
            : null,
        factor: material.getBaseColorFactor(),
        pbrBindPoint: PBRBindPoint.BASE_COLOR,
        pbrFactorStartPoint: PBRFactorsStartPoint.BASE_COLOR
    }
    dataMap.set(RenderFlag.BASE_COLOR, baseColorData);
    dataMap.set(RenderFlag.OPACITY, baseColorData);

    const mrTexture = material.getMetallicRoughnessTexture();
    const mrData = {
        texture: mrTexture
            ? {
                data: mrTexture.getImage() as TypedArray,
                size: mrTexture.getSize() as [number, number]
            }
            : null,
        factor: [material.getMetallicFactor(), material.getRoughnessFactor()],
        pbrBindPoint: PBRBindPoint.METALLIC_ROUGHNESS,
        pbrFactorStartPoint: PBRFactorsStartPoint.METALLIC_ROUGHNESS
    }
    dataMap.set(RenderFlag.METALLIC, mrData);
    dataMap.set(RenderFlag.ROUGHNESS, mrData);

    const normalTex = material.getNormalTexture();
    dataMap.set(RenderFlag.NORMAL, {
        texture: normalTex
            ? {
                data: normalTex.getImage() as TypedArray,
                size: normalTex.getSize() as [number, number]
            }
            : null,
        factor: material.getNormalScale(),
        pbrBindPoint: PBRBindPoint.NORMAL,
        pbrFactorStartPoint: PBRFactorsStartPoint.NORMAL
    });

    const occTex = material.getOcclusionTexture();
    dataMap.set(RenderFlag.OCCLUSION, {
        texture: occTex
            ? {
                data: occTex.getImage() as TypedArray,
                size: occTex.getSize() as [number, number]
            }
            : null,
        factor: material.getOcclusionStrength(),
        pbrBindPoint: PBRBindPoint.OCCLUSION,
        pbrFactorStartPoint: PBRFactorsStartPoint.OCCLUSION
    });

    const emissiveTex = material.getEmissiveTexture();
    dataMap.set(RenderFlag.EMISSIVE, {
        texture: emissiveTex
            ? {
                data: emissiveTex.getImage() as TypedArray,
                size: emissiveTex.getSize() as [number, number]
            }
            : null,
        factor: material.getEmissiveFactor(),
        pbrBindPoint: PBRBindPoint.EMISSIVE,
        pbrFactorStartPoint: PBRFactorsStartPoint.EMISSIVE
    });

    const extensions = extractExtensions(material)
    extensions.forEach((value, key) => {
        dataMap.set(key, value);
    })
    return dataMap
}

export async function hashAndCreateRenderSetup(computeManager: ComputeManager, gpuCache: GPUCache, materials: MaterialClass[], primitives: Primitive[], pipelineDescriptors: PipelineEntry) {
    const geometryLayoutHashes = gpuCache.createGeometryLayoutHashes(primitives)
    const materialHashes = await gpuCache.createMaterialHashes(materials)
    const shaderCodesHashes = gpuCache.createShaderCodeHashes(primitives)
    const pipelineLayoutsHashes = gpuCache.createPipelineLayoutHashes(pipelineDescriptors, materialHashes, geometryLayoutHashes)
    const pipelineHashes = gpuCache.createPipelineHashes(shaderCodesHashes, pipelineLayoutsHashes)
    const geometryBindGroupMaps = gpuCache.createGeometryBindGroupMaps(primitives)

    pipelineHashes.forEach((pipelineHash, key) => {
        const {side, id: primitiveId} = unpackPrimitiveKey(key)
        const geometryEntries = geometryBindGroupMaps.get(primitiveId)
        const geometryLayoutHash = geometryLayoutHashes.get(primitiveId)!
        const {bindGroup: materialBindGroupHash, layout: materialBindGroupLayoutHash} = materialHashes.get(primitiveId)!

        const shaderCodeHash = shaderCodesHashes.get(primitiveId)!

        const pipelineLayout = pipelineLayoutsHashes.get(primitiveId)
        if (!pipelineLayout) throw new Error("pipelineLayout is not set")
        const primitive = pipelineLayout?.primitive!
        const renderSetup = gpuCache.getRenderSetup(
            pipelineHash,
            pipelineLayout?.hash!,
            materialBindGroupHash,
            geometryLayoutHash,
            shaderCodeHash
        )
        if (!geometryEntries) throw new Error(`Primitive with id ${primitive.id} has no bindGroup descriptor set on geometry`)

        const geometryBindGroup = BaseLayer.device.createBindGroup({
            entries: geometryEntries,
            label: `${pipelineLayout?.sceneObject.name ?? ""} geometry bindGroup`,
            layout: renderSetup.geometryBindGroupLayout
        })

        primitive.setLodRanges(primitive.geometry.lodRanges)
        primitive.setIndexData(primitive.geometry.indices)
        const primitiveHashes: PrimitiveHashes = {
            shader: shaderCodeHash,
            materialBindGroup: materialBindGroupHash,
            materialBindGroupLayout: materialBindGroupLayoutHash,
            pipeline: pipelineHash,
            pipelineLayout: pipelineLayout.hash,
            samplerHash: primitive.material.hashes.sampler.new
        }

        primitive.setPrimitiveHashes(primitiveHashes, side!)
        primitive.setRenderSetup(geometryBindGroup, gpuCache)
        pipelineLayout?.primitive.vertexBufferDescriptors.forEach((item) => {
            const dataArray = primitive.geometry.dataList.get(item.name)?.array;
            if (!dataArray) throw new Error(`${item.name} not found in geometry datalist of primitive with id ${pipelineLayout.primitive.id}`)
            primitive.setVertexBuffers(createGPUBuffer(BaseLayer.device, dataArray, GPUBufferUsage.VERTEX, `${pipelineLayout.sceneObject.name}  ${item.name}`))
        })

        primitive.modelMatrix = (pipelineLayout?.sceneObject!).worldMatrix;
        primitive.normalMatrix = (pipelineLayout?.sceneObject!).normalMatrix;

        if (primitive.geometry.indices) {
            computeManager.setIndex(pipelineLayout.sceneObject)
        }
        computeManager.setIndirect(pipelineLayout.sceneObject)
    })
}