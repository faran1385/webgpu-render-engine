import {BaseLayer} from "../../../layers/baseLayer.ts";
// @ts-ignore
import computeShader from "../../../shaders/builtin/frustomCulling.wgsl?raw"
import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {createGPUBuffer, updateBuffer} from "../../../helpers/global.helper.ts";
import {mat4, vec3} from "gl-matrix";
import {vec4} from "gl-matrix";
import {ComputeFrustumCulling} from "./computeFrustumCulling.ts";

export class FrustumCulling extends BaseLayer {
    private static frustumCullingSceneObjects: Map<number, SceneObject> = new Map<number, SceneObject>();
    private static calculatedMinMaxes: Map<number, SceneObject> = new Map<number, SceneObject>();
    private static localLargeBufferVersions: Map<string, number> = new Map<string, number>();
    private static dispatchSize: number = 0;
    private static computeSetup: {
        pipeline: GPUComputePipeline,
        layout: GPUBindGroupLayout,
        bindGroup: GPUBindGroup
    } | undefined = undefined
    private static frustumCullingMinMaxCalculator: ComputeFrustumCulling;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        FrustumCulling.largeBufferMap.set("FrustumCullingMinMax", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        FrustumCulling.largeBufferMap.set("IndirectOffsets", {
            needsUpdate: false,
            array: [],
            version: 0
        })
        const {viewMatrix, projectionMatrix} = this.getCameraVP()
        FrustumCulling.largeBufferMap.set("FrustumCullingViewPlanes", {
            needsUpdate: false,
            buffer: createGPUBuffer(BaseLayer.device, new Float32Array(FrustumCulling.calculateFrustumPlanesFlat(viewMatrix, projectionMatrix)), GPUBufferUsage.UNIFORM, "global view planes"),
            array: [],
            version: 0
        })

        FrustumCulling.localLargeBufferVersions.set("Indirect", 0)

        FrustumCulling.frustumCullingMinMaxCalculator = new ComputeFrustumCulling();
    }

    private static initStaticSetup() {
        const layout = FrustumCulling.device.createBindGroupLayout({
            label: "frustum culling compute layout",
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

        const computeModule = FrustumCulling.device.createShaderModule({
            label: "frustom culling shader module",
            code: computeShader as string
        })

        const computePipeline = FrustumCulling.device.createComputePipeline({
            compute: {
                entryPoint: 'cs',
                module: computeModule
            },
            label: "frustum culling pipeline",
            layout: FrustumCulling.device.createPipelineLayout({
                label: "frustum culling  pipeline layout",
                bindGroupLayouts: [layout]
            })
        });

        return {layout, computePipeline}
    }

    private static initComputeSetup(): void {
        let fixedSetup;
        if (!FrustumCulling.computeSetup) fixedSetup = this.initStaticSetup()

        const indirect = BaseLayer.largeBufferMap.get("Indirect")!
        const minMax = BaseLayer.largeBufferMap.get("FrustumCullingMinMax")!;
        const indirectOffsets = BaseLayer.largeBufferMap.get("IndirectOffsets")!;
        const viewPlanes = BaseLayer.largeBufferMap.get("FrustumCullingViewPlanes")!;
        const bindGroup = FrustumCulling.device.createBindGroup({
            layout: fixedSetup?.layout ?? FrustumCulling.computeSetup?.layout as GPUBindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: viewPlanes.buffer as GPUBuffer
                }
            }, {
                binding: 1,
                resource: {
                    buffer: minMax.buffer as GPUBuffer
                }
            }, {
                binding: 2,
                resource: {
                    buffer: indirectOffsets.buffer as GPUBuffer
                }
            }, {
                binding: 3,
                resource: {
                    buffer: indirect.buffer as GPUBuffer
                }
            }]
        })

        FrustumCulling.localLargeBufferVersions.set("Indirect", indirect.version)

        FrustumCulling.computeSetup = {
            bindGroup,
            pipeline: fixedSetup?.computePipeline ?? FrustumCulling.computeSetup?.pipeline as GPUComputePipeline,
            layout: fixedSetup?.layout ?? FrustumCulling.computeSetup?.layout as GPUBindGroupLayout
        }
    }

    public appendFrustumCulling(sceneObject: SceneObject) {
        FrustumCulling.frustumCullingSceneObjects.set(sceneObject.id, sceneObject);
        const minMaxData = BaseLayer.largeBufferMap.get("FrustumCullingMinMax")!
        minMaxData.needsUpdate = true
    }

    private static resizeBuffer(bufferType: "minMax" | "offsets") {
        const largeBuffer = bufferType === "minMax" ? BaseLayer.largeBufferMap.get("FrustumCullingMinMax")! : BaseLayer.largeBufferMap.get("IndirectOffsets")!
        const array = bufferType === "minMax" ? new Float32Array(largeBuffer?.array as number[]) : new Uint32Array(largeBuffer?.array as number[])
        largeBuffer.buffer?.destroy();
        largeBuffer.buffer = createGPUBuffer(BaseLayer.device, array, GPUBufferUsage.STORAGE, `global ${bufferType} buffer`)
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    private static applyUpdate() {
        const frustumCullingMinMax = BaseLayer.largeBufferMap.get("FrustumCullingMinMax")!
        const indirectOffsets = BaseLayer.largeBufferMap.get("IndirectOffsets")!
        indirectOffsets.array = [];
        FrustumCulling.frustumCullingSceneObjects.forEach(sceneObject => {
            if (!sceneObject.frustumCullingMinMax) {
                FrustumCulling.frustumCullingMinMaxCalculator.appendToQueue(sceneObject, (T) => {
                    sceneObject.frustumCullingMinMax = {
                        min: T.min,
                        max: T.max
                    };
                    FrustumCulling.calculatedMinMaxes.set(sceneObject.id, sceneObject)

                    if (FrustumCulling.calculatedMinMaxes.size === FrustumCulling.frustumCullingSceneObjects.size) {
                        frustumCullingMinMax.array = [];
                        FrustumCulling.frustumCullingSceneObjects.forEach(sceneObject => {
                            sceneObject.primitives?.forEach(() => {
                                frustumCullingMinMax.array.push(...sceneObject.frustumCullingMinMax?.min as number[], ...sceneObject.frustumCullingMinMax?.max as number[])
                            })
                        })
                        FrustumCulling.resizeBuffer("minMax")
                    }
                })
            }
            sceneObject.primitives?.forEach((primitive) => {
                indirectOffsets.array.push(primitive.indirectBufferStartIndex)
            })
        })
        FrustumCulling.resizeBuffer("offsets")
        frustumCullingMinMax.needsUpdate = false;
        FrustumCulling.dispatchSize = Math.ceil(FrustumCulling.frustumCullingSceneObjects.size / 32);
    }


    private static getMatrixRow(m: Float32Array, row: number): vec4 {
        return [
            m[0 * 4 + row],
            m[1 * 4 + row],
            m[2 * 4 + row],
            m[3 * 4 + row],
        ];
    }

    private static inverseSqrt(x: number): number {
        return 1 / Math.sqrt(x);
    }


    private static calculateFrustumPlanesFlat(viewMatrix: mat4, projectionMatrix: mat4) {
        const vpMatrix = mat4.mul(mat4.create(), projectionMatrix, viewMatrix);
        const R0 = this.getMatrixRow(vpMatrix as Float32Array, 0);
        const R1 = this.getMatrixRow(vpMatrix as Float32Array, 1);
        const R2 = this.getMatrixRow(vpMatrix as Float32Array, 2);
        const R3 = this.getMatrixRow(vpMatrix as Float32Array, 3);

        const planes: vec4[] = [];
        planes.push(vec4.add(vec4.create(), R3, R0))
        planes.push(vec4.sub(vec4.create(), R3, R0))
        planes.push(vec4.add(vec4.create(), R3, R1))
        planes.push(vec4.sub(vec4.create(), R3, R1))
        planes.push(vec4.add(vec4.create(), R3, R2))
        planes.push(vec4.sub(vec4.create(), R3, R2))
        const flattedPlanes: number[] = []
        for (let i = 0; i < planes.length; i++) {
            const plane = planes[i]
            let n: vec3 = vec3.fromValues(plane[0], plane[1], plane[2]);

            let invLen = this.inverseSqrt(vec3.dot(n, n));
            const viewPlane = vec4.scale(vec4.create(), plane, invLen);
            const i4 = i * 4;
            flattedPlanes[i4] = viewPlane[0];
            flattedPlanes[i4 + 1] = viewPlane[1];
            flattedPlanes[i4 + 2] = viewPlane[2];
            flattedPlanes[i4 + 3] = viewPlane[3];
        }
        return flattedPlanes;
    }

    public renderLoop(commandEncoder: GPUCommandEncoder, viewMatrix: mat4, projectionMatrix: mat4) {
        if(FrustumCulling.frustumCullingSceneObjects.size > 0){
            const frustumCullingMinMax = BaseLayer.largeBufferMap.get("FrustumCullingMinMax")!
            const frustumCullingPlanes = BaseLayer.largeBufferMap.get("FrustumCullingViewPlanes")!
            updateBuffer(BaseLayer.device, frustumCullingPlanes.buffer as GPUBuffer, new Float32Array(FrustumCulling.calculateFrustumPlanesFlat(viewMatrix, projectionMatrix)));

            const indirect = BaseLayer.largeBufferMap.get("Indirect")!
            if (FrustumCulling.frustumCullingSceneObjects.size > 0 && indirect.buffer && indirect.buffer?.size > 0 && (frustumCullingMinMax.needsUpdate)) FrustumCulling.applyUpdate()

            if (indirect.buffer && frustumCullingMinMax.buffer && FrustumCulling.frustumCullingSceneObjects.size > 0 && (!FrustumCulling.computeSetup ||
                indirect.version !== FrustumCulling.localLargeBufferVersions.get("Indirect")
            )) FrustumCulling.initComputeSetup();

            if (FrustumCulling.computeSetup) {
                const computePass = commandEncoder.beginComputePass({
                    label: "frustum culling compute pass"
                })
                computePass.setPipeline(FrustumCulling.computeSetup.pipeline)
                computePass.setBindGroup(0, FrustumCulling.computeSetup.bindGroup)
                computePass.dispatchWorkgroups(FrustumCulling.dispatchSize)
                computePass.end()
            }
        }
    }
}