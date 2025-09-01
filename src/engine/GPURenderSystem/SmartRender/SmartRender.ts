import {Node} from "@gltf-transform/core";


import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {ShaderGenerator} from "../ShaderGenerator/ShaderGenerator.ts";
import {
    GeometryBindingPoint,
    PipelineShaderLocations,
} from "../../../helpers/Types.ts";
import {StandardMaterial} from "../../Material/StandardMaterial.ts";
import {isLightDependentMaterial} from "../../../helpers/global.helper.ts";
import {BaseLayer} from "../../../layers/baseLayer.ts";
import {MaterialLayoutGenerator} from "../MaterialLayoutGenerator/MaterialLayoutGenerator.ts";
import {MaterialInstance} from "../../Material/Material.ts";
import {Scene} from "../../scene/Scene.ts";

export class SmartRender {
    static defaultGeometryBindGroupLayout: GPUBindGroupLayoutEntry[][] = []
    static shaderGenerator: ShaderGenerator;
    static materialBindGroupGenerator: MaterialLayoutGenerator;

    constructor() {
        SmartRender.shaderGenerator = new ShaderGenerator()
        SmartRender.materialBindGroupGenerator = new MaterialLayoutGenerator()

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

    setGeometryBindGroups(sceneObjects: SceneObject[], nodeMap: undefined | Map<Node, SceneObject>) {

        sceneObjects.forEach(sceneObject => {
            const entries: (GPUBindGroupEntry & { name?: "model" | "normal" })[] = []
            const layoutEntries: GPUBindGroupLayoutEntry[] = []
            if (sceneObject.skin) {
                if (!nodeMap) throw new Error("in order to have skin u need to set the nodeMap on modelRenderer")
                const skinBuffer = sceneObject.scene.skinManager.getSkin(sceneObject.skin) ?? sceneObject.scene.skinManager.addSkin(sceneObject.skin, nodeMap)
                sceneObject.primitives?.forEach(primitive => {
                    primitive.geometry.shaderDescriptor.overrides.HAS_SKIN = true
                })
                entries.push({
                    binding: GeometryBindingPoint.SKIN,
                    resource: {
                        buffer: skinBuffer?.buffer
                    }
                })
                layoutEntries.push({
                    binding: GeometryBindingPoint.SKIN,
                    buffer: {type: "read-only-storage"},
                    visibility: GPUShaderStage.VERTEX
                })
                sceneObject.skinBuffer = skinBuffer?.buffer;
            }

            sceneObject.createModelBuffer(BaseLayer.device)
            layoutEntries.push({
                binding: GeometryBindingPoint.MODEL_MATRIX,
                buffer: {type: "uniform"},
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
            })
            entries.push({
                binding: GeometryBindingPoint.MODEL_MATRIX,
                resource: {
                    buffer: sceneObject.modelBuffer as GPUBuffer
                },
                name: "model"
            })

            const anyPrimHasNormal = Array.from(sceneObject.primitives!).some(([_, prim]) => {
                return prim.geometry.dataList.get('NORMAL')
            })

            if (anyPrimHasNormal) {
                sceneObject.createNormalBuffer(BaseLayer.device)
                layoutEntries.push({
                    binding: GeometryBindingPoint.NORMAL_MATRIX,
                    buffer: {type: "uniform"},
                    visibility: GPUShaderStage.VERTEX
                })
                entries.push({
                    binding: GeometryBindingPoint.NORMAL_MATRIX,
                    resource: {
                        buffer: sceneObject.normalBuffer as GPUBuffer
                    }
                })
            }

            sceneObject.primitives?.forEach(primitive => {
                primitive.geometry.descriptors.bindGroup = entries
                primitive.geometry.descriptors.layout = layoutEntries
            })
        })
    }

    setPipelineDescriptors(sceneObjects: SceneObject[]) {
        sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.primitives.forEach((primitive) => {
                    primitive.pipelineDescriptors.clear()
                    primitive.sides = []

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
                        geometry.shaderDescriptor.overrides.HAS_JOINTS = true;
                        geometry.shaderDescriptor.overrides.HAS_WEIGHTS = true;
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
                        geometry.shaderDescriptor.overrides.HAS_UV = true
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
                        geometry.shaderDescriptor.overrides.HAS_NORMAL_VEC3 = true
                    }
                    if (geometry.dataList.get(`TANGENT`)) {
                        buffers.push({
                            arrayStride: 4 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: PipelineShaderLocations.TANGENT,
                                format: "float32x4"
                            }],
                            name: `TANGENT`
                        })
                        geometry.shaderDescriptor.overrides.HAS_TANGENT_VEC4 = true
                    }
                    const isDoubleSided = primitive.material.isDoubleSided
                    const isTransparent = primitive.material.isTransparent


                    if (isLightDependentMaterial(primitive.material)) {
                        primitive.sceneObject.scene.addExposureDependent(primitive)
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
                                format: BaseLayer.format,
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
                                format: BaseLayer.format
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
                                format: "depth24plus",
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
                                format: BaseLayer.format
                            }],
                        })
                    }

                    primitive.material.isDoubleSided = isDoubleSided
                    primitive.setVertexBufferDescriptors(buffers)
                })
            }
        })

    }

    public entryCreator(
        sceneObjectsSet: Set<SceneObject>,
        nodeMap: undefined | Map<Node, SceneObject>,
        materials: MaterialInstance[],
        scene: Scene
    ) {
        const sceneObjects = this.getRenderAbleNodes(sceneObjectsSet)

        this.setPipelineDescriptors(sceneObjects)
        this.setGeometryBindGroups(sceneObjects, nodeMap)
        SmartRender.materialBindGroupGenerator.setDescriptors(materials)

        sceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach(p => {
                SmartRender.shaderGenerator.baseVertex(p.geometry)
            })
        })

        materials.forEach(mat => {
            // adding transmission objects to the scene
            if(mat.shaderDescriptor.overrides.HAS_TRANSMISSION){
                mat.primitives.forEach(p => {
                    BaseLayer.transmissionPrimitives.add(p)
                    scene.transmissionPrimitives.add(p)
                })
            }

            /// generating code
            if (mat instanceof StandardMaterial) {
                SmartRender.shaderGenerator.getStandardCode(mat)
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