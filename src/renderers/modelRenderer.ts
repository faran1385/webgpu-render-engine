import {BaseLayer, RenderAble, RenderAblePrim} from "../layers/baseLayer.ts";
import {computeNormalMatrix3x4, createGPUBuffer, updateBuffer} from "../helpers/global.helper.ts";
import {ComputeFrustumCulling} from "../scene/computeFrustumCulling.ts";
import {mat4} from "gl-matrix";
import {LODRange, MeshData} from "../scene/loader/loaderTypes.ts";
import {Material, Root} from "@gltf-transform/core";
import {hashCreationBindGroupEntry, HashGenerator} from "../scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {BindGroupEntryCreationType, RenderState} from "../scene/GPURenderSystem/GPUCache/GPUCacheTypes.ts";

export type Lod = {
    defaultLod: number
    applyBaseVertex: boolean
} | undefined

export type ComputeShader = {
    lod: {
        threshold: number
        applyBaseVertex: boolean
    }
} | undefined


type initEntry = {
    meshes: MeshData[],
    lod?: Lod,
    computeShader?: ComputeShader,
    materialBindGroupLayout: { layoutsEntries: GPUBindGroupLayoutEntry[][], primitiveIndex: number[] },
    geometryBindGroupLayout: { entries: GPUBindGroupLayoutEntry[][], primitiveIndex: number[] },
    pipelineDescriptors: RenderState[],
    geometryBindGroup: {
        entries: (GPUBindGroupEntry & {
            name: "model" | "normal";
        })[], mesh: MeshData
    }[],
    materialBindGroup: {
        hashEntries: hashCreationBindGroupEntry,
        entries: BindGroupEntryCreationType[],
        material: Material
    }[],
    shaderCodes: { codes: string[], primitiveIndex: number[] },
}

type modelRendererEntry = {
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    ctx: GPUCanvasContext,
    root: Root,
    boundingComputer: ComputeFrustumCulling,
    hasher: HashGenerator,
    gpuCache: GPUCache,
}

export class ModelRenderer extends BaseLayer {
    private ComputeBoundingSphere: ComputeFrustumCulling;
    private pushedIndices: { onRenderAble: number, onMeshes: number }[] = [];
    private meshes: MeshData[] = [];
    private root: Root;
    private hasher: HashGenerator;
    private gpuCache: GPUCache;

    constructor({device, canvas, ctx, root, hasher, gpuCache, boundingComputer}: modelRendererEntry) {
        super(device, canvas, ctx);
        this.ComputeBoundingSphere = boundingComputer;
        this.root = root;
        this.hasher = hasher;
        this.gpuCache = gpuCache;
    }

    applyTransformationsToRenderData({scale, translate, rotate}: {
        scale?: [number, number, number],
        translate?: [number, number, number],
        rotate?: {
            rad: number,
            axis: [number, number, number]
        },
    }) {
        this.pushedIndices.forEach((p) => {
            const item = ModelRenderer.renderAble[p.onRenderAble].renderData

            const modelMatrix = mat4.clone(item.model.data as mat4);
            if (translate) {
                mat4.translate(modelMatrix, modelMatrix, translate)
            }
            if (rotate) {
                mat4.rotate(modelMatrix, modelMatrix, rotate.rad, rotate.axis)
            }
            if (scale) {
                mat4.scale(modelMatrix, modelMatrix, scale)
            }
            updateBuffer(this.device, item.model.buffer, modelMatrix)
            item.model.data.set(modelMatrix)

            if (item.normal) {
                const normalMatrix = computeNormalMatrix3x4(modelMatrix)
                item.normal.data.set(normalMatrix)
                updateBuffer(this.device, item.normal.buffer, item.normal.data)
            }

            if (ModelRenderer.renderAble[p.onRenderAble].computeShader) {
                this.ComputeBoundingSphere.findNonBusyWorker(this.meshes[p.onMeshes], (T) => {
                    this.pushedIndices.forEach((p) => {
                        ModelRenderer.renderAble[p.onRenderAble].computeShader = {
                            ...ModelRenderer.renderAble[p.onRenderAble].computeShader as any,
                            frustumCulling: {
                                ...T
                            }
                        }
                    })
                }, modelMatrix)
            }
        })

    }


    public async init(
        {
            meshes,
            computeShader,
            lod,
            geometryBindGroup,
            materialBindGroup,
            geometryBindGroupLayout,
            pipelineDescriptors,
            materialBindGroupLayout,
            shaderCodes,
        }: initEntry
    ) {
        const pushedPrimIndices: { onRenderAble: number, onMeshes: number }[] = []
        this.meshes = meshes;

        const primitives = this.meshes.map((mesh) => mesh.geometry.flat());
        const materialLayoutHashes = materialBindGroupLayout.layoutsEntries.map((item) => {
            const hash = this.hasher.hashBindGroupLayout(item);
            this.gpuCache.appendBindGroupLayout(item, hash)
            return hash
        })

        const geometryLayoutHashes = geometryBindGroupLayout.entries.map((item) => {
            const hash = this.hasher.hashBindGroupLayout(item);
            this.gpuCache.appendBindGroupLayout(item, hash)
            return hash
        })
        const materialBindGroupHashes: number[] = [];


        for (let i = 0; i < materialBindGroup.length; i++) {
            const item = materialBindGroup[i];
            const hash = await this.hasher.hashBindGroup(item.hashEntries);
            materialBindGroupHashes[i] = hash;
            await this.gpuCache.appendMaterialBindGroup(
                item.entries,
                hash,
                materialLayoutHashes[materialBindGroupLayout.primitiveIndex[i]],
                item.material,
                this.root.listExtensionsUsed()
            );
        }
        const shaderCodesHashes: number[] = [];
        for (let i = 0; i < primitives.length; i++) {
            const code = shaderCodes.codes[shaderCodes.primitiveIndex[i]];
            const hash = await this.hasher.hashShaderModule(code)
            shaderCodesHashes[i] = hash;

            this.gpuCache.appendShaderModule(code, hash)
        }
        const pipelineLayoutsHashes = primitives.map((_, i) => {
            const hash = this.hasher.hashPipelineLayout(materialLayoutHashes[materialBindGroupLayout.primitiveIndex[i]], geometryLayoutHashes[geometryBindGroupLayout.primitiveIndex[i]])
            this.gpuCache.appendPipelineLayout(hash, materialLayoutHashes[materialBindGroupLayout.primitiveIndex[i]], geometryLayoutHashes[geometryBindGroupLayout.primitiveIndex[i]])
            return hash
        })
        const pipelineHashes = primitives.map((_, i) => {
            const hash = this.hasher.hashPipeline(pipelineDescriptors[i],pipelineLayoutsHashes[i])
            this.gpuCache.appendPipeline(pipelineDescriptors[i], hash, pipelineLayoutsHashes[i], shaderCodesHashes[i])
            return hash
        })

        const renderSetups = primitives.map((_, i) => {


            return this.gpuCache.getRenderSetup(
                pipelineHashes[i],
                pipelineLayoutsHashes[i],
                materialBindGroupHashes[i],
                materialLayoutHashes[materialBindGroupLayout.primitiveIndex[i]],
                geometryLayoutHashes[geometryBindGroupLayout.primitiveIndex[i]],
                shaderCodesHashes[shaderCodes.primitiveIndex[i]]
            )
        })

        const geometryBindGroups = geometryBindGroup.map((item, i) => {
            const bindGroup = this.device.createBindGroup({
                entries: item.entries,
                layout: renderSetups[i].geometryBindGroupLayout
            })
            return item.mesh.geometry.map(() => bindGroup)
        }).flat()
        let globalPrimIndex = 0;

        meshes.forEach((mesh, index) => {

            let renderAble: RenderAble = {
                prims: [],
                renderData: {
                    name: mesh.nodeName,
                    model: {
                        buffer: (geometryBindGroup[index].entries.find(item => item.name === "model") as any).resource.buffer as GPUBuffer,
                        data: mesh.localMatrix
                    },
                    normal: geometryBindGroup[index].entries.find(item => item.name === "normal") ? {
                        buffer: (geometryBindGroup[index].entries.find(item => item.name === "normal") as any).resource.buffer,
                        data: mesh.normalMatrix
                    } : undefined
                },
                computeShader: computeShader ? {
                    frustumCulling: {
                        min: [0, 0, 0],
                        max: [0, 0, 0]
                    },
                    lod: {
                        ...computeShader.lod
                    }
                } : undefined,
            }

            mesh.geometry.forEach((prim, i) => {
                const renderSetup = renderSetups[globalPrimIndex]

                let renderAblePrim: RenderAblePrim = {
                    pipeline: renderSetup.pipeline,
                    bindGroups: [ModelRenderer.globalBindGroup.bindGroup, renderSetup.materialBindGroup, geometryBindGroups[globalPrimIndex]],
                    vertexBuffers: [],
                    index: null,
                    lodRanges: prim.lodRanges,
                }

                pipelineDescriptors[globalPrimIndex].buffers.forEach((item) => {
                    renderAblePrim.vertexBuffers.push(createGPUBuffer(this.device, prim.dataList[item.name]?.array as Float32Array, GPUBufferUsage.VERTEX, `${mesh.nodeName} prim ${i} ${item.name}`))
                })

                if (meshes[index].geometry[i].indexType !== "Unknown" && meshes[index].geometry[i].indices) {

                    renderAblePrim.index = {
                        buffer: createGPUBuffer(this.device, meshes[index].geometry[i].indices, GPUBufferUsage.INDEX, "index buffer"),
                        type: meshes[index].geometry[i].indexType as "uint16" | "uint32"
                    }
                    renderAblePrim.indirect = {
                        indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                            lod ? (prim.lodRanges as LODRange[])[lod.defaultLod].count : prim.indexCount,
                            1,
                            lod ? (prim.lodRanges as LODRange[])[lod.defaultLod].start : 0,
                            lod && lod.applyBaseVertex ? (prim.lodRanges as LODRange[])[lod.defaultLod].baseVertex : 0,
                            0
                        ]), GPUBufferUsage.INDIRECT, `${mesh.nodeName} prim ${i} indirect buffer`),
                        indirectOffset: 0
                    }
                } else {

                    renderAblePrim.indirect = {
                        indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                            prim.indexCount,
                            1,
                            0,
                            0,
                            0
                        ]), GPUBufferUsage.INDIRECT, `${mesh.nodeName} prim ${i} indirect buffer`),
                        indirectOffset: 0
                    }
                }
                renderAble.prims.push(renderAblePrim)
                globalPrimIndex++
            })
            pushedPrimIndices.push({
                onMeshes: index,
                onRenderAble: ModelRenderer.renderAble.length
            })
            ModelRenderer.setRenderAble = renderAble;
        })

        this.pushedIndices = pushedPrimIndices;

        if (computeShader) {
            meshes.forEach(mesh => {
                this.ComputeBoundingSphere.findNonBusyWorker(mesh, (T) => {

                    this.pushedIndices.forEach((item) => {
                        ModelRenderer.renderAble[item.onRenderAble].computeShader = {
                            ...ModelRenderer.renderAble[item.onRenderAble].computeShader as any,
                            frustumCulling: {
                                ...T
                            }
                        }
                    })
                }, mesh.localMatrix as mat4)
            })
        }
    }
}