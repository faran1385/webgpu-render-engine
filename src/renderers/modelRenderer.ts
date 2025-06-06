import {BaseLayer, RenderAble, RenderAblePrim} from "../layers/baseLayer.ts";
import {computeNormalMatrix3x4, createGPUBuffer, updateBuffer} from "../helpers/global.helper.ts";
import {ComputeFrustumCulling} from "../scene/computeFrustumCulling.ts";
import {mat4} from "gl-matrix";
import {GeometryData, LODRange, MeshData} from "../scene/loader/loaderTypes.ts";
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

export type ShaderCodeEntry = { code: string, primitivesId: number[] }
export type MaterialBindGroupEntry = {
    hashEntries: hashCreationBindGroupEntry,
    entries: BindGroupEntryCreationType[],
    material: Material,
    primitiveId: number
}
export type BindGroupEntryLayout = {
    layoutsEntries: GPUBindGroupLayoutEntry[],
    primitivesId: number[]
}[]
export type PipelineEntry = {
    pipelineEntries: (RenderState & { primitiveId: number, prim: GeometryData })[],
    mesh: MeshData
}[]
export type GeometryBindGroupEntry = {
    entries: (GPUBindGroupEntry & {
        name: "model" | "normal",
    })[], mesh: MeshData,
    primitivesId: number[],
    indexOnMeshes: number
}[]

export type SmartRenderInitEntryPassType = {
    meshes: MeshData[],
    materialBindGroupLayout: BindGroupEntryLayout,
    geometryBindGroupLayout: BindGroupEntryLayout,
    pipelineDescriptors: PipelineEntry,
    geometryBindGroups: GeometryBindGroupEntry,
    materialBindGroup: MaterialBindGroupEntry[],
    shaderCodes: ShaderCodeEntry[],
}

type initEntry = {
    lod?: Lod,
    computeShader?: ComputeShader,
} & SmartRenderInitEntryPassType

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
            geometryBindGroups,
            materialBindGroup,
            geometryBindGroupLayout,
            pipelineDescriptors,
            materialBindGroupLayout,
            shaderCodes,
        }: initEntry
    ) {

        const pushedPrimIndices: { onRenderAble: number, onMeshes: number }[] = []
        this.meshes = meshes;

        const materialLayoutHashes = materialBindGroupLayout.map((item) => {
            const hash = this.hasher.hashBindGroupLayout(item.layoutsEntries);
            this.gpuCache.appendBindGroupLayout(item.layoutsEntries, hash)

            return {
                hash,
                primitivesId: item.primitivesId
            }
        })
        const geometryLayoutHashes = geometryBindGroupLayout.map((item) => {
            const hash = this.hasher.hashBindGroupLayout(item.layoutsEntries);
            this.gpuCache.appendBindGroupLayout(item.layoutsEntries, hash)
            return {
                hash,
                primitivesId: item.primitivesId
            }
        })

        const materialBindGroupHashes: {
            hash: number,
            primitiveId: number
        }[] = [];
        for (let i = 0; i < materialBindGroup.length; i++) {

            const materialItem = materialBindGroup[i];

            const hash = await this.hasher.hashBindGroup(materialItem.hashEntries);
            let materialLayout = materialLayoutHashes.find((layout) => layout.primitivesId.find(id => materialItem.primitiveId === id));
            materialBindGroupHashes[i] = {
                hash,
                primitiveId: materialItem.primitiveId
            };
            await this.gpuCache.appendMaterialBindGroup(
                materialItem.entries,
                hash,
                materialLayout?.hash as number,
                materialItem.material,
                this.root.listExtensionsUsed()
            );

        }

        const shaderCodesHashes: { hash: number, primitivesId: number[] }[] = [];
        for (let i = 0; i < shaderCodes.length; i++) {
            const item = shaderCodes[i];
            const hash = await this.hasher.hashShaderModule(item.code)
            shaderCodesHashes[i] = {
                hash,
                primitivesId: item.primitivesId
            };
            this.gpuCache.appendShaderModule(item.code, hash)
        }

        const pipelineLayoutsHashes: {
            mesh: MeshData,
            pipelineLayouts: ({
                hash: number,
                primitiveId: number,
                materialLayoutHash: number,
                geometryLayoutHash: number,
                prim: GeometryData,
                buffers: (GPUVertexBufferLayout & {
                    name: string
                })[]
            } & RenderState)[]
        }[] = [];
        for (let i = 0; i < pipelineDescriptors.length; i++) {
            const item = pipelineDescriptors[i];
            const primitivesData: ({
                hash: number,
                primitiveId: number,
                materialLayoutHash: number,
                geometryLayoutHash: number,
                prim: GeometryData,
                buffers: (GPUVertexBufferLayout & {
                    name: string
                })[]
            } & RenderState)[] = []
            item.pipelineEntries.forEach(pipelineItem => {
                let materialLayout = materialLayoutHashes.find((layout) => layout.primitivesId.find(id => pipelineItem.primitiveId === id));
                let geometryLayout = geometryLayoutHashes.find((layout) => layout.primitivesId.find(id => pipelineItem.primitiveId === id));

                const hash = this.hasher.hashPipelineLayout(
                    materialLayout?.hash as number,
                    geometryLayout?.hash as number
                )
                this.gpuCache.appendPipelineLayout(
                    hash,
                    materialLayout?.hash as number,
                    geometryLayout?.hash as number
                )
                primitivesData.push({
                    ...pipelineItem,
                    hash,
                    prim: pipelineItem.prim,
                    materialLayoutHash: materialLayout?.hash as number,
                    geometryLayoutHash: geometryLayout?.hash as number,
                    buffers: pipelineItem.buffers
                })
            })

            pipelineLayoutsHashes.push({
                pipelineLayouts: primitivesData,
                mesh: item.mesh
            })
        }
        const pipelineHashes = pipelineLayoutsHashes.map((item) => {
            return {
                mesh: item.mesh,
                primitivesPipelines: item.pipelineLayouts.map((item) => {
                    const shaderCodeHash = shaderCodesHashes.find((code) => code.primitivesId.find(id => item.primitiveId === id));
                    const hash = this.hasher.hashPipeline(item, item.hash)
                    this.gpuCache.appendPipeline(item, hash, item.hash, shaderCodeHash?.hash as number)
                    return {
                        hash: hash,
                        primitiveId: item.primitiveId,
                        layoutHash: item.hash,
                        materialLayoutHash: item.materialLayoutHash,
                        geometryLayoutHash: item.geometryLayoutHash,
                        shaderCodeHash: shaderCodeHash?.hash as number,
                        prim: item.prim,
                        buffers: item.buffers
                    }
                })
            }
        })


        pipelineHashes.forEach(({mesh, primitivesPipelines}) => {
            const geometryEntries = geometryBindGroups.find(item => item.primitivesId.includes(primitivesPipelines[0].primitiveId))

            const geometryBindGroup = this.device.createBindGroup({
                entries: geometryEntries?.entries as any,
                layout: this.gpuCache.getGeometryLayout(primitivesPipelines[0].geometryLayoutHash)
            })

            let renderAble: RenderAble = {
                prims: [],
                renderData: {
                    name: mesh.nodeName,
                    model: {
                        buffer: (geometryEntries?.entries.find(item => item.name === "model") as any).resource.buffer as GPUBuffer,
                        data: mesh.localMatrix
                    },
                    normal: geometryEntries?.entries.find(item => item.name === "normal") ? {
                        buffer: (geometryEntries?.entries.find(item => item.name === "normal") as any).resource.buffer,
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


            primitivesPipelines.forEach(pipelineItem => {

                let materialBindGroupHash = materialBindGroupHashes.find((bindGroup) => pipelineItem.primitiveId === bindGroup.primitiveId);
                const renderSetup = this.gpuCache.getRenderSetup(
                    pipelineItem.hash,
                    pipelineItem.layoutHash,
                    materialBindGroupHash?.hash as number,
                    pipelineItem.materialLayoutHash,
                    pipelineItem.geometryLayoutHash,
                    pipelineItem.shaderCodeHash
                )

                let renderAblePrim: RenderAblePrim = {
                    pipeline: renderSetup.pipeline,
                    bindGroups: [ModelRenderer.globalBindGroup.bindGroup, renderSetup.materialBindGroup, geometryBindGroup],
                    vertexBuffers: [],
                    index: null,
                    lodRanges: pipelineItem.prim.lodRanges,
                }

                pipelineItem.buffers.forEach((item) => {
                    renderAblePrim.vertexBuffers.push(createGPUBuffer(this.device, pipelineItem.prim.dataList[item.name]?.array as Float32Array, GPUBufferUsage.VERTEX, `${mesh.nodeName}  ${item.name}`))
                })

                if (pipelineItem.prim.indexType !== "Unknown" && pipelineItem.prim.indices) {

                    renderAblePrim.index = {
                        buffer: createGPUBuffer(this.device, pipelineItem.prim.indices, GPUBufferUsage.INDEX, "index buffer"),
                        type: pipelineItem.prim.indexType as "uint16" | "uint32"
                    }
                    renderAblePrim.indirect = {
                        indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                            lod ? (pipelineItem.prim.lodRanges as LODRange[])[lod.defaultLod].count : pipelineItem.prim.indexCount,
                            1,
                            lod ? (pipelineItem.prim.lodRanges as LODRange[])[lod.defaultLod].start : 0,
                            lod && lod.applyBaseVertex ? (pipelineItem.prim.lodRanges as LODRange[])[lod.defaultLod].baseVertex : 0,
                            0
                        ]), GPUBufferUsage.INDIRECT, `${mesh.nodeName}  indirect buffer`),
                        indirectOffset: 0
                    }
                } else {

                    renderAblePrim.indirect = {
                        indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                            pipelineItem.prim.indexCount,
                            1,
                            0,
                            0,
                            0
                        ]), GPUBufferUsage.INDIRECT, `${mesh.nodeName} indirect buffer`),
                        indirectOffset: 0
                    }
                }
                renderAble.prims.push(renderAblePrim)
            })
            pushedPrimIndices.push({
                onMeshes: geometryEntries?.indexOnMeshes as number,
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