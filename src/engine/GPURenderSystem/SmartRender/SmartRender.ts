import {Node} from "@gltf-transform/core";


import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {ShaderGenerator} from "../ShaderGenerator/ShaderGenerator.ts";
import {MaterialDescriptorGenerator} from "../MaterialDescriptorGenerator/MaterialDescriptorGenerator.ts";
import {PipelineShaderLocations} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {StandardMaterial} from "../../Material/StandardMaterial.ts";
import {isLightDependentMaterial} from "../../../helpers/global.helper.ts";

export class SmartRender {
    static device: GPUDevice;
    static format: GPUTextureFormat;
    static defaultGeometryBindGroupLayout: GPUBindGroupLayoutEntry[][] = []
    static shaderGenerator: ShaderGenerator;
    static materialBindGroupGenerator: MaterialDescriptorGenerator;

    constructor(device: GPUDevice, format: GPUTextureFormat) {
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

    getGeometryBindGroups(sceneObjects: SceneObject[], nodeMap: undefined | Map<Node, SceneObject>) {

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

    getPipelineDescriptors(sceneObjects: SceneObject[]) {
        sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.primitives.forEach((primitive) => {
                    primitive.pipelineDescriptors.clear()

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
                    if (geometry.dataList.get(`TANGENT`)) {
                        buffers.push({
                            arrayStride: 3 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: PipelineShaderLocations.TANGENT,
                                format: "float32x3"
                            }],
                            name: `TANGENT`
                        })
                    }
                    const isDoubleSided = primitive.material.isDoubleSided
                    const isTransparent = primitive.material.alpha.mode === "BLEND"
                    const fragmentConstant: any = {
                        ALPHA_MODE: primitive.material.alpha.mode === "OPAQUE" ? 0 : primitive.material.alpha.mode === "BLEND" ? 1 : 2,
                        ALPHA_CUTOFF: primitive.material.alpha.cutoff
                    }
                    if (isLightDependentMaterial(primitive.material)) {
                        primitive.sceneObject.scene.addExposureDependent(primitive)
                        fragmentConstant.TONE_MAPPING_NUMBER = primitive.sceneObject.scene.getToneMapping(primitive)
                        fragmentConstant.EXPOSURE = primitive.sceneObject.scene.environmentManager.getExposure()
                    }

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
                                format: SmartRender.format,
                            }],
                            fragmentConstants: fragmentConstant
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
                            fragmentConstants: fragmentConstant
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
                            fragmentConstants: fragmentConstant
                        })
                    }

                    primitive.setIsTransparent(isTransparent)
                    primitive.setVertexBufferDescriptors(buffers)
                })
            }
        })

    }

    public entryCreator(
        sceneObjectsSet: Set<SceneObject>,
        nodeMap: undefined | Map<Node, SceneObject>
    ) {
        const sceneObjects = this.getRenderAbleNodes(sceneObjectsSet)

        sceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach(primitive => {
                primitive.material.initDescriptor(SmartRender.materialBindGroupGenerator)
            })
        })
        this.getPipelineDescriptors(sceneObjects)
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
                    if (primitive.material instanceof StandardMaterial) {
                        code = SmartRender.shaderGenerator.getStandardCode(primitive)
                    }
                    primitive.material.shaderCode = code
                })
            }
        })

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