import {BaseLayer, RenderAble, RenderAblePrim} from "../layers/baseLayer.ts";
import {computeNormalMatrix3x4, createGPUBuffer, updateBuffer} from "../helpers/global.helper.ts";
import {ComputeFrustumCulling} from "../scene/computeFrustumCulling.ts";
import {mat4} from "gl-matrix";
import {LODRange, MeshData, RenderSetup, SelectiveResource, ShaderFlag} from "../scene/loader/loaderTypes.ts";
import {Root} from "@gltf-transform/core";
import {Material} from "../scene/material/material.ts";
import {Pipeline} from "../scene/material/pipeline.ts";

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
    computeShader?: ComputeShader
    shaderCode: ShaderFlag,
    materialSelectiveResources?: SelectiveResource[],
    pipelineSelectiveResources?: SelectiveResource[],
}


export class ModelRenderer extends BaseLayer {
    private ComputeBoundingSphere: ComputeFrustumCulling;
    private pushedIndices: { onRenderAble: number, onMeshes: number }[] = [];
    private meshes: MeshData[] = [];
    private root: Root;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, root: Root, boundingComputer: ComputeFrustumCulling) {
        super(device, canvas, ctx);
        this.ComputeBoundingSphere = boundingComputer;
        this.root = root;
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


    public async init({
                          meshes,
                          materialSelectiveResources,
                          pipelineSelectiveResources,
                          shaderCode,
                          computeShader,
                          lod
                      }: initEntry) {
        this.meshes = meshes;
        const materialList = this.root.listMaterials();
        const extensions = this.root.listExtensionsUsed();

        const renderSetups = await Promise.all(materialList.map(async (mat) => {
            const material = new Material(this.device, this.canvas, this.ctx, mat, extensions, materialSelectiveResources);
            return {
                ...await material.init(),
                materialPointer: mat,
            }
        }))
        const pushedPrimIndices: { onRenderAble: number, onMeshes: number }[] = []

        meshes.forEach((mesh, index) => {
            const modelBuffer = createGPUBuffer(this.device, mesh.localMatrix, GPUBufferUsage.UNIFORM, `model important data ${mesh.nodeName}`);
            // const normalBuffer = createGPUBuffer(this.device, mesh.normalMatrix, GPUBufferUsage.UNIFORM, `normal important data ${mesh.nodeName}`)

            let renderAble: RenderAble = {
                prims: [],
                renderData: {
                    name: mesh.nodeName,
                    model: {
                        data: mesh.localMatrix,
                        buffer: modelBuffer
                    },
                    // normal: {
                    //     data: mesh.normalMatrix,
                    //     buffer: normalBuffer
                    // }
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
                const renderSetup = renderSetups.find((item) => item.materialPointer === prim.material) as RenderSetup
                const pipelineInstance = new Pipeline(
                    this.device, this.canvas,
                    this.ctx, renderSetup, prim,
                    shaderCode, modelBuffer, undefined, pipelineSelectiveResources
                );
                const {bindGroup, pipeline} = pipelineInstance.init()

                let renderAblePrim: RenderAblePrim = {
                    pipeline: pipeline,
                    bindGroups: [ModelRenderer.globalBindGroup.bindGroup, renderSetup.bindGroup, bindGroup],
                    vertexBuffers: [],
                    index: null,
                    lodRanges: prim.lodRanges,
                }
                renderAblePrim.vertexBuffers.push(createGPUBuffer(this.device, prim.vertex.position?.array as Float32Array, GPUBufferUsage.VERTEX, `${mesh.nodeName} prim ${i} position`))
                if (pipelineSelectiveResources?.includes(SelectiveResource.UV) && prim.vertex.uv) {

                    renderAblePrim.vertexBuffers.push(createGPUBuffer(this.device, prim.vertex.uv.array, GPUBufferUsage.VERTEX, `${mesh.nodeName} prim ${i} uv`))
                }
                if (pipelineSelectiveResources?.includes(SelectiveResource.NORMAL) && prim.vertex.normal) {

                    renderAblePrim.vertexBuffers.push(createGPUBuffer(this.device, prim.vertex.normal.array, GPUBufferUsage.VERTEX, `${mesh.nodeName} prim ${i} normal`))
                }

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