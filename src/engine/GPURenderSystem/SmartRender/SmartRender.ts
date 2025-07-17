import {Node} from "@gltf-transform/core";

import {
    SmartRenderInitEntryPassType, PipelineEntry
} from "../../../renderers/modelRenderer.ts";

import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {ShaderGenerator} from "../ShaderGenerator/ShaderGenerator.ts";
import {
    MaterialDescriptorGenerator
} from "../MaterialDescriptorGenerator/MaterialDescriptorGenerator.ts";
import {PipelineShaderLocations, RenderFlag} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";

export class SmartRender {
    static device: GPUDevice;
    static format: GPUTextureFormat;
    static defaultGeometryBindGroupLayout: GPUBindGroupLayoutEntry[][] = []
    static shaderGenerator: ShaderGenerator;
    static materialBindGroupGenerator: MaterialDescriptorGenerator;

    constructor(device: GPUDevice,format:GPUTextureFormat) {
        SmartRender.device = device;
        SmartRender.format = format;
        SmartRender.shaderGenerator = new ShaderGenerator()
        SmartRender.materialBindGroupGenerator = new MaterialDescriptorGenerator(device)

        SmartRender.defaultGeometryBindGroupLayout.push([{
            binding: 0,
            buffer: {
                type: "uniform",
            },
            visibility: GPUShaderStage.VERTEX
        }], [{
            binding: 1,
            buffer: {
                type: "read-only-storage",
            },
            visibility: GPUShaderStage.VERTEX
        }])
    }

    private getGeometryBindGroups(sceneObjects: SceneObject[], nodeMap: undefined | Map<Node, SceneObject>) {

        sceneObjects.forEach(sceneObject => {
            const entries: (GPUBindGroupEntry & { name?: "model" | "normal" })[] = []

            if (sceneObject.skin) {
                if (!nodeMap) throw new Error("in order to have skin u need to set the nodeMap on modelRenderer")
                const skinBuffer = sceneObject.scene.skinManager.getSkin(sceneObject.skin) ?? sceneObject.scene.skinManager.addSkin(sceneObject.skin, nodeMap)

                entries.push({
                    binding: 1,
                    resource: {
                        buffer: skinBuffer?.buffer
                    }
                })
                sceneObject.skinBuffer = skinBuffer?.buffer;
            } else {
                sceneObject.createModelBuffer(SmartRender.device, sceneObject.worldMatrix)
                entries.push({
                    binding: 0,
                    resource: {
                        buffer: sceneObject.modelBuffer as GPUBuffer
                    },
                    name: "model"
                })
            }

            sceneObject.primitives?.forEach(primitive => {
                primitive.geometry.descriptors.bindGroup = entries
            })
        })
    }

    private getPipelineDescriptors(sceneObjects: SceneObject[]): PipelineEntry {
        const output: PipelineEntry = []
        sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.primitives.forEach((primitive) => {
                    const geometry = primitive.geometry;
                    const buffers: (GPUVertexBufferLayout & { name: string; })[] = [{
                        arrayStride: 3 * 4,
                        attributes: [{
                            offset: 0,
                            shaderLocation: PipelineShaderLocations.POSITION,
                            format: "float32x3"
                        }],
                        name: 'POSITION'
                    }]
                    if (geometry.dataList.get("JOINTS_0") && geometry.dataList.get("WEIGHTS_0")) {
                        buffers.push({
                            arrayStride: 4 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: PipelineShaderLocations.JOINTS,
                                format: "uint32x4"
                            }],
                            name: `JOINTS_0`
                        })
                        buffers.push({
                            arrayStride: 4 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: PipelineShaderLocations.WEIGHTS,
                                format: "float32x4"
                            }],
                            name: `WEIGHTS_0`
                        })
                    }
                    if (geometry.dataList.get(`TEXCOORD_0`)) {
                        buffers.push({
                            arrayStride: 2 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: PipelineShaderLocations.UV,
                                format: "float32x2"
                            }],
                            name: `TEXCOORD_0`
                        })
                    }
                    if (geometry.dataList.get(`NORMAL`)) {
                        buffers.push({
                            arrayStride: 3 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: PipelineShaderLocations.NORMAL,
                                format: "float32x3"
                            }],
                            name: `NORMAL`
                        })
                    }
                    const isDoubleSided = primitive.material.isDoubleSided
                    const isTransparent = primitive.material.alpha.mode === "BLEND"

                    if (isTransparent && isDoubleSided) {
                        primitive.setSide("back")
                        primitive.setSide("front")
                        primitive.setPipelineDescriptor("front", {
                            primitive: {
                                cullMode: "front",
                                frontFace: "ccw",
                            },
                            depthStencil: {
                                depthCompare: "less",
                                depthWriteEnabled: false,
                                format: "depth24plus"
                            },
                            targets: [{
                                writeMask: GPUColorWrite.ALL,
                                blend: {
                                    color: {
                                        srcFactor: "src-alpha",
                                        dstFactor: "one-minus-src-alpha",
                                        operation: "add",
                                    },
                                    alpha: {
                                        srcFactor: "one",
                                        dstFactor: "zero",
                                        operation: "add",
                                    },
                                },
                                format: SmartRender.format
                            }],
                        })
                        primitive.setPipelineDescriptor("back", {
                            primitive: {
                                cullMode: "back",
                                frontFace: "ccw",
                            },
                            depthStencil: {
                                depthCompare: "less",
                                depthWriteEnabled: false,
                                format: "depth24plus"
                            },
                            targets: [{
                                writeMask: GPUColorWrite.ALL,
                                blend: {
                                    color: {
                                        srcFactor: "src-alpha",
                                        dstFactor: "one-minus-src-alpha",
                                        operation: "add",
                                    },
                                    alpha: {
                                        srcFactor: "one",
                                        dstFactor: "zero",
                                        operation: "add",
                                    },
                                },
                                format: SmartRender.format
                            }],
                        })

                    } else {

                        primitive.setSide(isDoubleSided ? "none" : "back")

                        primitive.setPipelineDescriptor(isDoubleSided ? "none" : "back", {
                            primitive: {
                                cullMode: isDoubleSided ? "none" : "back",
                            },
                            depthStencil: {
                                depthCompare: "less",
                                depthWriteEnabled: !isTransparent,
                                format: "depth24plus"
                            },
                            targets: [{
                                writeMask: GPUColorWrite.ALL,
                                blend: isTransparent ? {
                                    color: {
                                        srcFactor: "src-alpha",
                                        dstFactor: "one-minus-src-alpha",
                                        operation: "add",
                                    },
                                    alpha: {
                                        srcFactor: "one",
                                        dstFactor: "zero",
                                        operation: "add",
                                    },
                                } : undefined,
                                format: SmartRender.format
                            }],
                        })
                    }
                    primitive.setIsTransparent(isTransparent)
                    primitive.setVertexBufferDescriptors(buffers)
                    output.push({
                        primitive,
                        sceneObject,
                    })
                })
            }
        })

        return output
    }

    public entryCreator(
        sceneObjectsSet: Set<SceneObject>,
        renderFlag: RenderFlag,
        nodeMap: undefined | Map<Node, SceneObject>
    ): SmartRenderInitEntryPassType {
        const sceneObjects = this.getRenderAbleNodes(sceneObjectsSet)

        sceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach(primitive => {
                primitive.material.initDescriptor(SmartRender.materialBindGroupGenerator)
            })
        })
        const pipelineDescriptors = this.getPipelineDescriptors(sceneObjects)
        this.getGeometryBindGroups(sceneObjects, nodeMap)


        sceneObjects.forEach((sceneObject) => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.primitives.forEach((primitive) => {
                    const geometry = primitive.geometry
                    const hasBoneData = Boolean(geometry.dataList.get('JOINTS_0') && geometry.dataList.get("WEIGHTS_0"))

                    if (hasBoneData) {
                        primitive.geometry.descriptors.layout = SmartRender.defaultGeometryBindGroupLayout[1]
                    } else {
                        primitive.geometry.descriptors.layout = SmartRender.defaultGeometryBindGroupLayout[0]
                    }

                    let code = '';
                    if (RenderFlag.PBR !== renderFlag) {
                        code = SmartRender.shaderGenerator.getInspectCode(primitive, renderFlag!)
                    } else {
                        code = SmartRender.shaderGenerator.getPBRCode(primitive)
                    }
                    primitive.material.setShaderCodeString(code)
                })
            }
        })

        return {
            pipelineDescriptors,
        }
    }

    private getRenderAbleNodes(sceneObjects: Set<SceneObject>) {
        const renderAbleNodes: SceneObject[] = []
        sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                renderAbleNodes.push(sceneObject)
            }
        })

        return renderAbleNodes
    }

}