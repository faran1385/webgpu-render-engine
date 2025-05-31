import {BaseLayer} from "./baseLayer.ts";
// @ts-ignore
import lodShader from "../shaders/builtin/lod.wgsl?raw"
import {mat4, vec3} from "gl-matrix";
import {createGPUBuffer, updateBuffer} from "../helpers/global.helper.ts";
import {TypedArray} from "@gltf-transform/core";


export class MainLayer extends BaseLayer {
    private static computePipeline: GPUComputePipeline;
    private static cameraPosBuffer: GPUBuffer;
    private static lodRenderAbleBuffer: GPUBuffer;
    private static lodRenderAbleResultBuffer: GPUBuffer;
    private static lodRangesBuffer: GPUBuffer;
    private static frustumCullingBuffer: GPUBuffer;
    private static computeBindGroup: GPUBindGroup;
    private static maxLodDriven: number;
    private static maxTotalLodLevel: number;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, maxLodDriven: number, maxTotalLodLevel: number) {
        super(device, canvas, ctx);
        if (this.constructor === MainLayer) {
            MainLayer.maxLodDriven = maxLodDriven
            MainLayer.maxTotalLodLevel = maxTotalLodLevel
            this.init()
        }
    }



    private getCameraCurrentPosition() {
        let camPos: vec3;
        if (BaseLayer.getActiveCameraIndex === 0) {
            camPos = BaseLayer.controls.update().position
        } else {
            camPos = BaseLayer.cameras[BaseLayer.getActiveCameraIndex - 1].getPosition();
        }

        updateBuffer(this.device, MainLayer.cameraPosBuffer, camPos as TypedArray)
    }

    private getModelWorldPosition(modelMatrix: mat4): vec3 {
        const localOrigin = vec3.fromValues(0, 0, 0);
        return vec3.transformMat4(vec3.create(), localOrigin, modelMatrix);
    }

    private updateViewProjection() {
        let projectionMatrix;
        let viewMatrix;
        if (MainLayer.getActiveCameraIndex === 0) {
            const updatedData = MainLayer.controls.update();
            projectionMatrix = updatedData.projectionMatrix;
            viewMatrix = updatedData.viewMatrix;
        } else {
            projectionMatrix = MainLayer.cameras[MainLayer.getActiveCameraIndex].getProjectionMatrix();
            viewMatrix = MainLayer.cameras[MainLayer.getActiveCameraIndex].getViewMatrix();
        }

        const VP = mat4.multiply(mat4.create(), projectionMatrix, viewMatrix);

        updateBuffer(this.device, MainLayer.frustumCullingBuffer, VP as TypedArray);
    }


    private init() {
        const computeModule = this.device.createShaderModule({
            label: "main compute shader",
            code: lodShader as string
        })
        MainLayer.cameraPosBuffer = createGPUBuffer(this.device, new Float32Array([0, 0, 0]), GPUBufferUsage.STORAGE, "cameraPositionBuffer")
        MainLayer.lodRenderAbleBuffer = createGPUBuffer(this.device, new Float32Array(MainLayer.maxLodDriven * 12), GPUBufferUsage.STORAGE, "lodRenderAbleBuffer")
        MainLayer.lodRangesBuffer = createGPUBuffer(this.device, new Float32Array(MainLayer.maxTotalLodLevel * 3), GPUBufferUsage.STORAGE, "lodRenderAbleBuffer")
        MainLayer.frustumCullingBuffer = createGPUBuffer(this.device, new Float32Array(40), GPUBufferUsage.UNIFORM, "frustum Culling buffer")
        MainLayer.lodRenderAbleResultBuffer = createGPUBuffer(this.device, new Uint32Array(MainLayer.maxLodDriven * 5), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.INDIRECT, "lodRenderAbleResultBuffer")
        this.updateViewProjection()
        window.addEventListener("keydown", async (event) => {
            if (event.key === "s") {
                const x = new Uint32Array(MainLayer.maxLodDriven * 5)
                const readBuffer = createGPUBuffer(this.device, x, GPUBufferUsage.MAP_READ, "")
                const encoder = this.device.createCommandEncoder()
                encoder.copyBufferToBuffer(MainLayer.lodRenderAbleResultBuffer, 0, readBuffer, 0, x.byteLength)
                this.device.queue.submit([encoder.finish()])
                await readBuffer.mapAsync(GPUMapMode.READ)
                console.log(new Uint32Array(readBuffer.getMappedRange()))
                readBuffer.unmap()
            }
        })
        const layout = this.device.createBindGroupLayout({
            label: "main compute layout",
            entries: [{
                buffer: {
                    type: "read-only-storage",
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
            }, {
                buffer: {
                    type: "read-only-storage",
                },
                binding: 4,
                visibility: GPUShaderStage.COMPUTE
            }, {
                buffer: {
                    type: "uniform",
                },
                binding: 5,
                visibility: GPUShaderStage.COMPUTE
            }]
        })
        MainLayer.computeBindGroup = this.device.createBindGroup({
            layout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: MainLayer.cameraPosBuffer
                }
            }, {
                binding: 1,
                resource: {
                    buffer: MainLayer.lodRenderAbleBuffer
                }
            }, {
                binding: 2,
                resource: {
                    buffer: MainLayer.lodRangesBuffer
                }
            }, {
                binding: 3,
                resource: {
                    buffer: MainLayer.lodRenderAbleResultBuffer
                }
            }, {
                binding: 4,
                resource: {
                    buffer: createGPUBuffer(this.device, new Uint32Array([MainLayer.maxLodDriven]), GPUBufferUsage.STORAGE, "")
                }
            }, {
                binding: 5,
                resource: {
                    buffer: MainLayer.frustumCullingBuffer
                }
            }]
        })

        MainLayer.computePipeline = this.device.createComputePipeline({
            compute: {
                entryPoint: 'cs',
                module: computeModule
            },
            label: "",
            layout: this.device.createPipelineLayout({
                label: "main compute pipeline",
                bindGroupLayouts: [layout]
            })
        });
    }


    public render(commandEncoder: GPUCommandEncoder) {
        let computes = BaseLayer.renderAble.filter((item) => item.computeShader)

        if (computes.length !== 0) {
            this.updateViewProjection()
            const computePrims = computes.map((item) => {
                return item.prims.map((prim) => ({
                    prim,
                    mesh: item
                }))
            }).flat()

            const renderAbleInfo = new Float32Array(computePrims.length * 12);

            const lodNumbers: number[] = computes.flatMap(renderAble =>
                renderAble.prims.flatMap(prim =>
                    prim.lodRanges?.flatMap(lod => [lod.count, lod.start, renderAble.computeShader?.lod.applyBaseVertex ? lod.baseVertex : 0]) ?? []
                )
            );

            const renderAbleLodRanges = new Float32Array(lodNumbers);

            let lodOffset = 0;
            computePrims.forEach((data, i) => {
                const i12 = i * 12;
                const worldPos = this.getModelWorldPosition(data.mesh.renderData.model.data as mat4);

                renderAbleInfo[i12] = worldPos[0];
                renderAbleInfo[i12 + 1] = worldPos[1];
                renderAbleInfo[i12 + 2] = worldPos[2];
                renderAbleInfo[i12 + 3] = (data.mesh.computeShader as any).lod.threshold;
                renderAbleInfo[i12 + 4] = data.prim.lodRanges?.length ?? 0;
                renderAbleInfo[i12 + 5] = lodOffset;
                renderAbleInfo[i12 + 6] = data.mesh.computeShader?.frustumCulling.min[0] ?? 0;
                renderAbleInfo[i12 + 7] = data.mesh.computeShader?.frustumCulling.min[1] ?? 0;
                renderAbleInfo[i12 + 8] = data.mesh.computeShader?.frustumCulling.min[2] ?? 0;
                renderAbleInfo[i12 + 9] = data.mesh.computeShader?.frustumCulling.max[0] ?? 0;
                renderAbleInfo[i12 + 10] = data.mesh.computeShader?.frustumCulling.max[1] ?? 0;
                renderAbleInfo[i12 + 11] = data.mesh.computeShader?.frustumCulling.max[2] ?? 0;

                lodOffset += (data.prim.lodRanges?.length ?? 0) * 3;
            })

            updateBuffer(this.device, MainLayer.lodRenderAbleBuffer, renderAbleInfo)
            updateBuffer(this.device, MainLayer.lodRangesBuffer, renderAbleLodRanges)
            this.getCameraCurrentPosition()

            const dispatchSize = Math.ceil(computes.length / 32);
            const computePass = commandEncoder.beginComputePass({
                label: "main compute pass"
            })
            computePass.setPipeline(MainLayer.computePipeline)
            computePass.setBindGroup(0, MainLayer.computeBindGroup)
            computePass.dispatchWorkgroups(dispatchSize)
            computePass.end()
        }
        const pass = commandEncoder.beginRenderPass({
            label: "main pass",
            depthStencilAttachment: {
                view: MainLayer.depthTexture.createView(),
                depthStoreOp: "store",
                depthLoadOp: "clear",
                depthClearValue: 1.
            },
            colorAttachments: [{
                view: this.ctx.getCurrentTexture().createView(),
                storeOp: "store",
                loadOp: "load",
            }]
        })
        BaseLayer.renderAble.forEach((item) => {
            item.prims.forEach((prim, i) => {
                pass.setPipeline(prim.pipeline)
                prim.bindGroups.forEach((group, i) => {
                    pass.setBindGroup(i, group)
                })
                prim.vertexBuffers.forEach((buffer, i) => {
                    pass.setVertexBuffer(i, buffer)
                })

                if (prim.index && item.computeShader) {
                    pass.setIndexBuffer(prim.index.buffer, prim.index.type)
                    pass.drawIndexedIndirect(MainLayer.lodRenderAbleResultBuffer, i * 5 * 4)
                } else if (prim.indirect && prim.index) {

                    pass.setIndexBuffer(prim.index.buffer, prim.index.type)
                    pass.drawIndexedIndirect(prim.indirect.indirectBuffer, prim.indirect.indirectOffset)
                } else if (prim.indirect) {
                    pass.drawIndirect(prim.indirect.indirectBuffer, prim.indirect.indirectOffset)
                }
            })
        })

        pass.end()
    }
}