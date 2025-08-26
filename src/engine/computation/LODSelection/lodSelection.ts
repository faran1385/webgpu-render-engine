import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {createGPUBuffer} from "../../../helpers/global.helper.ts";
// @ts-ignore
import {Scene} from "../../scene/Scene.ts";
import {BaseLayer} from "../../../layers/baseLayer.ts";

export class LodSelection extends BaseLayer{
    private  lodSelectionSceneObjects: Set<SceneObject> = new Set<SceneObject>();
    private  localLargeBufferVersions: Map<string, number> = new Map<string, number>();
    private  dispatchSize: number = 0;
    private  computeSetup: {
        pipeline: GPUComputePipeline,
        layout: GPUBindGroupLayout,
        bindGroup: GPUBindGroup
    } | undefined = undefined
    private device: GPUDevice;
    private scene: Scene;

    constructor(scene: Scene, device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        this.device = device;
        this.scene = scene;

        this.scene.largeBufferMap.set("LODSelectionData", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        this.scene.largeBufferMap.set("LODSelectionOffsets", {
            needsUpdate: false,
            array: [],
            version: 0
        })
        this.localLargeBufferVersions.set("Indirect", 0)
        this.inspector()

    }

    private inspector() {
        window.addEventListener("keypress", async (e) => {
            if (e.key === "s") {
                const indirect = this.scene.largeBufferMap.get("Indirect")?.buffer as GPUBuffer
                const resultBuffer = this.scene.device.createBuffer({
                    size: indirect.size,
                    label:"result Buffer",
                    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
                })
                const encoder = this.device.createCommandEncoder()
                encoder.copyBufferToBuffer(indirect, resultBuffer, resultBuffer.size)
                this.device.queue.submit([encoder.finish()])
                await this.device.queue.onSubmittedWorkDone()
                await resultBuffer.mapAsync(GPUMapMode.READ)
                const data = new Uint32Array(resultBuffer.getMappedRange())
                console.log(data)
            }
        })
    }


    private initComputeSetup(): void {
        const indirect = this.scene.largeBufferMap.get("Indirect")!
        const offsets = this.scene.largeBufferMap.get("LODSelectionOffsets")!
        const lodesData = this.scene.largeBufferMap.get("LODSelectionData")!
        this.localLargeBufferVersions.set("Indirect", indirect.version)

        const bindGroup = this.device.createBindGroup({
            layout: BaseLayer.lodFixedComputeSetup.bindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: this.scene.getActiveCamera().getBuffers().position
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


        this.computeSetup = {
            bindGroup,
            pipeline: BaseLayer.lodFixedComputeSetup.pipeline,
            layout: BaseLayer.lodFixedComputeSetup.bindGroupLayout
        }
    }

    public appendLodSelection(sceneObject: SceneObject) {
        this.lodSelectionSceneObjects.add(sceneObject);
        const offsets = this.scene.largeBufferMap.get("LODSelectionOffsets")!
        offsets.needsUpdate = true
    }

    private resizeBuffer(bufferType: "lodesData" | "offsets") {
        const largeBuffer = bufferType === "offsets" ? this.scene.largeBufferMap.get("LODSelectionOffsets")! : this.scene.largeBufferMap.get("LODSelectionData")!
        largeBuffer.buffer?.destroy();
        largeBuffer.buffer = createGPUBuffer(this.scene.device, bufferType === "lodesData" ? new Float32Array(largeBuffer?.array as number[]) : new Uint32Array(largeBuffer?.array as number[]), GPUBufferUsage.STORAGE, `global ${bufferType} buffer`)
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    private applyUpdate() {
        const offsets = this.scene.largeBufferMap.get("LODSelectionOffsets")!
        const lodesData = this.scene.largeBufferMap.get("LODSelectionData")!
        offsets.array = [];
        lodesData.array = [];

        this.lodSelectionSceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach((primitive) => {
                if (!primitive.lodRanges || primitive.lodRanges.length === 0) throw new Error("sceneObject does not have lodRanges")
                const flattedPrimitiveLod = primitive.lodRanges.map(lod => [lod.start, lod.count]).flat();
                const offsetInIndirectBuffer = primitive.indirectBufferStartIndex
                if (!sceneObject.lodSelectionThreshold) throw new Error("lodRange threshold is not set")
                const dataArray = [sceneObject.getPosition(), sceneObject.lodSelectionThreshold, primitive.lodRanges.length, flattedPrimitiveLod].flat();
                offsets.array.push(lodesData.array.length, offsetInIndirectBuffer);
                for (let i = 0, len = dataArray.length; i < len; i++) {
                    lodesData.array.push(dataArray[i]);
                }
            })
        })

        this.resizeBuffer("offsets")
        this.resizeBuffer("lodesData")
        this.dispatchSize = Math.ceil(this.lodSelectionSceneObjects.size / 32);
    }

    public renderLoop(commandEncoder: GPUCommandEncoder) {
        if(this.lodSelectionSceneObjects.size > 0){
            const offsets = this.scene.largeBufferMap.get("LODSelectionOffsets")!
            const lodesData = this.scene.largeBufferMap.get("LODSelectionData")!
            const indirect = this.scene.largeBufferMap.get("Indirect")!
            if (this.lodSelectionSceneObjects.size > 0 && indirect.buffer && indirect.buffer?.size > 0 && (offsets.needsUpdate || lodesData.needsUpdate)) this.applyUpdate()

            if (indirect.buffer && this.lodSelectionSceneObjects.size > 0 && (!this.computeSetup ||
                indirect.version !== this.localLargeBufferVersions.get("Indirect")
            )) this.initComputeSetup();
            if (this.computeSetup) {
                const computePass = commandEncoder.beginComputePass({
                    label: "lod selection compute pass"
                })

                computePass.setPipeline(this.computeSetup.pipeline)
                computePass.setBindGroup(0, this.computeSetup.bindGroup)
                computePass.dispatchWorkgroups(this.dispatchSize)
                computePass.end()
            }
        }

    }

}