import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {createGPUBuffer, updateBuffer} from "../../../helpers/global.helper.ts";
import {mat4, vec3} from "gl-matrix";
import {vec4} from "gl-matrix";
import {ComputeFrustumCulling} from "./computeFrustumCulling.ts";
import {Scene} from "../../scene/Scene.ts";
import {BaseLayer} from "../../../layers/baseLayer.ts";

export class FrustumCulling extends BaseLayer {
    private frustumCullingSceneObjects: Map<number, SceneObject> = new Map<number, SceneObject>();
    private calculatedMinMaxes: Map<number, SceneObject> = new Map<number, SceneObject>();
    private localLargeBufferVersions: Map<string, number> = new Map<string, number>();
    private dispatchSize: number = 0;
    private computeSetup: {
        pipeline: GPUComputePipeline,
        layout: GPUBindGroupLayout,
        bindGroup: GPUBindGroup
    } | undefined = undefined
    private device: GPUDevice
    private scene: Scene

    private frustumCullingMinMaxCalculator: ComputeFrustumCulling;

    constructor(scene: Scene, device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        this.device = device;
        this.scene = scene;
        scene.largeBufferMap.set("FrustumCullingMinMax", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        scene.largeBufferMap.set("IndirectOffsets", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        const activeCamera = scene.getActiveCamera()
        const viewMatrix = activeCamera.getViewMatrix()
        const projectionMatrix = activeCamera.getProjectionMatrix()

        scene.largeBufferMap.set("FrustumCullingViewPlanes", {
            needsUpdate: false,
            buffer: createGPUBuffer(this.device, new Float32Array(this.calculateFrustumPlanesFlat(viewMatrix, projectionMatrix)), GPUBufferUsage.UNIFORM, "global view planes"),
            array: [],
            version: 0
        })

        this.localLargeBufferVersions.set("Indirect", 0)

        this.frustumCullingMinMaxCalculator = new ComputeFrustumCulling();
    }


    private initComputeSetup(): void {

        const indirect = this.scene.largeBufferMap.get("Indirect")!
        const minMax = this.scene.largeBufferMap.get("FrustumCullingMinMax")!;
        const indirectOffsets = this.scene.largeBufferMap.get("IndirectOffsets")!;
        const viewPlanes = this.scene.largeBufferMap.get("FrustumCullingViewPlanes")!;
        const bindGroup = this.device.createBindGroup({
            layout: BaseLayer.frustumFixedComputeSetup.bindGroupLayout,
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

        this.localLargeBufferVersions.set("Indirect", indirect.version)

        this.computeSetup = {
            bindGroup,
            pipeline: BaseLayer.frustumFixedComputeSetup.pipeline,
            layout: BaseLayer.frustumFixedComputeSetup.bindGroupLayout
        }
    }

    public appendFrustumCulling(sceneObject: SceneObject) {
        this.frustumCullingSceneObjects.set(sceneObject.id, sceneObject);
        const minMaxData = this.scene.largeBufferMap.get("FrustumCullingMinMax")!
        minMaxData.needsUpdate = true
    }

    private resizeBuffer(bufferType: "minMax" | "offsets") {
        const largeBuffer = bufferType === "minMax" ? this.scene.largeBufferMap.get("FrustumCullingMinMax")! : this.scene.largeBufferMap.get("IndirectOffsets")!
        const array = bufferType === "minMax" ? new Float32Array(largeBuffer?.array as number[]) : new Uint32Array(largeBuffer?.array as number[])
        largeBuffer.buffer?.destroy();
        largeBuffer.buffer = createGPUBuffer(this.scene.device, array, GPUBufferUsage.STORAGE, `global ${bufferType} buffer`)
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    private applyUpdate() {
        const frustumCullingMinMax = this.scene.largeBufferMap.get("FrustumCullingMinMax")!
        const indirectOffsets = this.scene.largeBufferMap.get("IndirectOffsets")!
        indirectOffsets.array = [];
        this.frustumCullingSceneObjects.forEach(sceneObject => {
            if (!sceneObject.frustumCullingMinMax) {
                this.frustumCullingMinMaxCalculator.appendToQueue(sceneObject, (T) => {
                    sceneObject.frustumCullingMinMax = {
                        min: T.min,
                        max: T.max
                    };
                    this.calculatedMinMaxes.set(sceneObject.id, sceneObject)

                    if (this.calculatedMinMaxes.size === this.frustumCullingSceneObjects.size) {
                        frustumCullingMinMax.array = [];
                        this.frustumCullingSceneObjects.forEach(sceneObject => {
                            sceneObject.primitives?.forEach(() => {
                                frustumCullingMinMax.array.push(...sceneObject.frustumCullingMinMax?.min as number[], ...sceneObject.frustumCullingMinMax?.max as number[])
                            })
                        })
                        this.resizeBuffer("minMax")
                    }
                })
            }
            sceneObject.primitives?.forEach((primitive) => {
                indirectOffsets.array.push(primitive.indirectBufferStartIndex)
            })
        })
        this.resizeBuffer("offsets")
        frustumCullingMinMax.needsUpdate = false;
        this.dispatchSize = Math.ceil(this.frustumCullingSceneObjects.size / 32);
    }


    private getMatrixRow(m: Float32Array, row: number): vec4 {
        return [
            m[0 * 4 + row],
            m[1 * 4 + row],
            m[2 * 4 + row],
            m[3 * 4 + row],
        ];
    }

    private inverseSqrt(x: number): number {
        return 1 / Math.sqrt(x);
    }


    private calculateFrustumPlanesFlat(viewMatrix: mat4, projectionMatrix: mat4) {
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
        if (this.frustumCullingSceneObjects.size > 0) {
            const frustumCullingMinMax = this.scene.largeBufferMap.get("FrustumCullingMinMax")!
            const frustumCullingPlanes = this.scene.largeBufferMap.get("FrustumCullingViewPlanes")!
            updateBuffer(this.scene.device, frustumCullingPlanes.buffer as GPUBuffer, new Float32Array(this.calculateFrustumPlanesFlat(viewMatrix, projectionMatrix)));

            const indirect = this.scene.largeBufferMap.get("Indirect")!
            if (this.frustumCullingSceneObjects.size > 0 && indirect.buffer && indirect.buffer?.size > 0 && (frustumCullingMinMax.needsUpdate)) this.applyUpdate()

            if (indirect.buffer && frustumCullingMinMax.buffer && this.frustumCullingSceneObjects.size > 0 && (!this.computeSetup ||
                indirect.version !== this.localLargeBufferVersions.get("Indirect")
            )) this.initComputeSetup();

            if (this.computeSetup) {
                const computePass = commandEncoder.beginComputePass({
                    label: "frustum culling compute pass"
                })
                computePass.setPipeline(this.computeSetup.pipeline)
                computePass.setBindGroup(0, this.computeSetup.bindGroup)
                computePass.dispatchWorkgroups(this.dispatchSize)
                computePass.end()
            }
        }
    }
}