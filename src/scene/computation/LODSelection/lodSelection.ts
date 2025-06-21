import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {BaseLayer} from "../../../layers/baseLayer.ts";
import {createGPUBuffer} from "../../../helpers/global.helper.ts";
// @ts-ignore
import computeShader from "../../../shaders/builtin/lod.wgsl?raw"
import {ComputeManager} from "../computeManager.ts";

export class LodSelection extends BaseLayer {
    private static lodSelectionSceneObjects: Set<SceneObject> = new Set<SceneObject>();
    private static localLargeBufferVersions: Map<string, number> = new Map<string, number>();
    private static dispatchSize: number = 0;
    private static computeSetup: {
        pipeline: GPUComputePipeline,
        layout: GPUBindGroupLayout,
        bindGroup: GPUBindGroup
    } | undefined = undefined

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        LodSelection.largeBufferMap.set("LODSelectionData", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        LodSelection.largeBufferMap.set("LODSelectionOffsets", {
            needsUpdate: false,
            array: [],
            version: 0
        })
        LodSelection.localLargeBufferVersions.set("Indirect", 0)
        this.inspector()

    }

    private inspector() {
        window.addEventListener("keypress", async (e) => {
            if (e.key === "s") {
                const indirect = BaseLayer.largeBufferMap.get("Indirect")?.buffer as GPUBuffer
                const resultBuffer = BaseLayer.device.createBuffer({
                    size: indirect.size,
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
                })
                const encoder = LodSelection.device.createCommandEncoder()
                encoder.copyBufferToBuffer(indirect, resultBuffer, resultBuffer.size)
                LodSelection.device.queue.submit([encoder.finish()])
                await LodSelection.device.queue.onSubmittedWorkDone()
                await resultBuffer.mapAsync(GPUMapMode.READ)
                const data = new Uint32Array(resultBuffer.getMappedRange())
                console.log(data)
            }
        })
    }

    private static initStaticSetup() {
        const layout = LodSelection.device.createBindGroupLayout({
            label: "lod compute layout",
            entries: [{
                buffer: {
                    type: "uniform",
                },
                binding: 0,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 1,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 2,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "storage",
                },
                binding: 3,
                visibility: GPUShaderStage.COMPUTE
            }]
        })

        const computeModule = LodSelection.device.createShaderModule({
            label: "lodSelection shader module",
            code: computeShader as string
        })

        const computePipeline = LodSelection.device.createComputePipeline({
            compute: {
                entryPoint: 'cs',
                module: computeModule
            },
            label: "lodSelection pipeline",
            layout: LodSelection.device.createPipelineLayout({
                label: "lodSelection pipeline layout",
                bindGroupLayouts: [layout]
            })
        });

        return {layout, computePipeline}
    }

    private static initComputeSetup(): void {
        let fixedSetup;
        if (!LodSelection.computeSetup) fixedSetup = this.initStaticSetup()

        const indirect = BaseLayer.largeBufferMap.get("Indirect")!
        const offsets = BaseLayer.largeBufferMap.get("LODSelectionOffsets")!
        const lodesData = BaseLayer.largeBufferMap.get("LODSelectionData")!
        LodSelection.localLargeBufferVersions.set("Indirect", indirect.version)

        const bindGroup = LodSelection.device.createBindGroup({
            layout: fixedSetup?.layout ?? LodSelection.computeSetup?.layout as GPUBindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: ComputeManager.cameraPositionBuffer as GPUBuffer
                }
            }, {
                binding: 1,
                resource: {
                    buffer: offsets.buffer as GPUBuffer
                }
            }, {
                binding: 2,
                resource: {
                    buffer: lodesData.buffer as GPUBuffer
                }
            }, {
                binding: 3,
                resource: {
                    buffer: indirect.buffer as GPUBuffer
                }
            }]
        })


        LodSelection.computeSetup = {
            bindGroup,
            pipeline: fixedSetup?.computePipeline ?? LodSelection.computeSetup?.pipeline as GPUComputePipeline,
            layout: fixedSetup?.layout ?? LodSelection.computeSetup?.layout as GPUBindGroupLayout
        }
    }

    public appendLodSelection(sceneObject: SceneObject) {
        LodSelection.lodSelectionSceneObjects.add(sceneObject);
        const offsets = BaseLayer.largeBufferMap.get("LODSelectionOffsets")!
        offsets.needsUpdate = true
    }

    private static resizeBuffer(bufferType: "lodesData" | "offsets") {
        const largeBuffer = bufferType === "offsets" ? BaseLayer.largeBufferMap.get("LODSelectionOffsets")! : BaseLayer.largeBufferMap.get("LODSelectionData")!
        largeBuffer.buffer?.destroy();
        largeBuffer.buffer = createGPUBuffer(BaseLayer.device, bufferType === "lodesData" ? new Float32Array(largeBuffer?.array as number[]) : new Uint32Array(largeBuffer?.array as number[]), GPUBufferUsage.STORAGE, `global ${bufferType} buffer`)
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    private static applyUpdate() {
        const offsets = BaseLayer.largeBufferMap.get("LODSelectionOffsets")!
        const lodesData = BaseLayer.largeBufferMap.get("LODSelectionData")!
        offsets.array = [];
        lodesData.array = [];

        LodSelection.lodSelectionSceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach((primitive, key) => {
                if (!primitive.lodRanges || primitive.lodRanges.length === 0) throw new Error("sceneObject does not have lodRanges")
                const flattedPrimitiveLod = primitive.lodRanges.map(lod => [lod.start, lod.count]).flat();
                const offsetInIndirectBuffer = sceneObject.indirectBufferStartIndex.get(key) as number
                if (!sceneObject.lodSelectionThreshold) throw new Error("lodRange threshold is not set")
                const dataArray = [sceneObject.getPosition(), sceneObject.lodSelectionThreshold, primitive.lodRanges.length, flattedPrimitiveLod].flat();
                offsets.array.push(lodesData.array.length, offsetInIndirectBuffer);
                lodesData.array.push(...dataArray)
            })
        })

        LodSelection.resizeBuffer("offsets")
        LodSelection.resizeBuffer("lodesData")
        LodSelection.dispatchSize = Math.ceil(LodSelection.lodSelectionSceneObjects.size / 32);
    }

    public renderLoop(commandEncoder: GPUCommandEncoder) {
        const offsets = BaseLayer.largeBufferMap.get("LODSelectionOffsets")!
        const lodesData = BaseLayer.largeBufferMap.get("LODSelectionData")!
        const indirect = BaseLayer.largeBufferMap.get("Indirect")!
        if (LodSelection.lodSelectionSceneObjects.size > 0 && indirect.buffer && indirect.buffer?.size > 0 && (offsets.needsUpdate || lodesData.needsUpdate)) LodSelection.applyUpdate()

        if (indirect.buffer && LodSelection.lodSelectionSceneObjects.size > 0 && (!LodSelection.computeSetup ||
            indirect.version !== LodSelection.localLargeBufferVersions.get("Indirect")
        )) LodSelection.initComputeSetup();
        if (LodSelection.lodSelectionSceneObjects.size > 0 && LodSelection.computeSetup) {
            const computePass = commandEncoder.beginComputePass({
                label: "lod selection compute pass"
            })

            computePass.setPipeline(LodSelection.computeSetup.pipeline)
            computePass.setBindGroup(0, LodSelection.computeSetup.bindGroup)
            computePass.dispatchWorkgroups(LodSelection.dispatchSize)
            computePass.end()
        }
    }

}