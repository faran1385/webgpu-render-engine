import { computeNormalMatrix3x4, createGPUBuffer } from "../helpers/global.helper.ts";

import { mat4 } from "gl-matrix";
// @ts-ignore
import cubeShader from "../shaders/builtin/cube.wgsl?raw";
import {readyBindGroup} from "../layers/baseLayer.ts";



export const cubeVertexArray = new Float32Array([
    // float4 position, float2 uv,
    // bottom
    1, -1, 1, 1,   0, 1,
    -1, -1, 1, 1,  1, 1,
    -1, -1, -1, 1, 1, 0,
    1, -1, -1, 1,  0, 0,
    1, -1, 1, 1,   0, 1,
    -1, -1, -1, 1, 1, 0,
    //right
    1, 1, 1, 1,    0, 1,
    1, -1, 1, 1,   1, 1,
    1, -1, -1, 1,  1, 0,
    1, 1, -1, 1,   0, 0,
    1, 1, 1, 1,    0, 1,
    1, -1, -1, 1,  1, 0,
    //top
    -1, 1, 1, 1,   0, 1,
    1, 1, 1, 1,    1, 1,
    1, 1, -1, 1,   1, 0,
    -1, 1, -1, 1,  0, 0,
    -1, 1, 1, 1,   0, 1,
    1, 1, -1, 1,   1, 0,
    // left
    -1, -1, 1, 1,  0, 1,
    -1, 1, 1, 1,   1, 1,
    -1, 1, -1, 1,  1, 0,
    -1, -1, -1, 1, 0, 0,
    -1, -1, 1, 1,  0, 1,
    -1, 1, -1, 1,  1, 0,
    // front
    1, 1, 1, 1,    0, 1,
    -1, 1, 1, 1,   1, 1,
    -1, -1, 1, 1,  1, 0,
    -1, -1, 1, 1,  1, 0,
    1, -1, 1, 1,   0, 0,
    1, 1, 1, 1,    0, 1,
    // back
    1, -1, -1, 1,  0, 1,
    -1, -1, -1, 1, 1, 1,
    -1, 1, -1, 1,  1, 0,
    1, 1, -1, 1,   0, 0,
    1, -1, -1, 1,  0, 1,
    -1, 1, -1, 1,  1, 0,
]);


export class EnvironmentCube {
    private readonly device: GPUDevice;
    private readonly scale: number;
    private cubeMap: GPUTexture;
    private readonly defaultFormat: GPUTextureFormat;
    private globalBindGroup: readyBindGroup;

    private cubeBindGroup?: GPUBindGroup;
    private cubePipeline?: GPURenderPipeline;
    private cubeVertexBuffer?: GPUBuffer;

    constructor(
        scale: number,
        device: GPUDevice,
        cubeMap: GPUTexture,
        defaultFormat: GPUTextureFormat,
        globalBindGroup: readyBindGroup
    ) {
        this.device = device;
        this.scale = scale;
        this.cubeMap = cubeMap;
        this.defaultFormat = defaultFormat;
        this.globalBindGroup = globalBindGroup;

        this.init();
    }

    private init() {
        const cubeModule = this.device.createShaderModule({
            label: "shader cube module",
            code: cubeShader as string,
        });

        this.cubeVertexBuffer = createGPUBuffer(this.device, cubeVertexArray, GPUBufferUsage.VERTEX, "");

        const cubeModelMatrix = mat4.create();
        mat4.scale(cubeModelMatrix, cubeModelMatrix, [this.scale, this.scale, this.scale]);
        const cubeNormalMatrix = computeNormalMatrix3x4(cubeModelMatrix);

        const cubeLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    buffer: { type: "uniform" },
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                },
                {
                    buffer: { type: "uniform" },
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                },
                {
                    texture: { viewDimension: "cube", sampleType: "float" },
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 2,
                },
                {
                    sampler: { type: "filtering" },
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: 3,
                },
            ],
        });

        const cubeSampler = this.device.createSampler({
            addressModeU: "repeat",
            addressModeV: "repeat",
            addressModeW: "repeat",
            minFilter: "linear",
            magFilter: "linear",
        });

        this.cubeBindGroup = this.device.createBindGroup({
            layout: cubeLayout,
            entries: [
                {
                    resource: {
                        buffer: createGPUBuffer(this.device, cubeModelMatrix, GPUBufferUsage.UNIFORM, ""),
                    },
                    binding: 0,
                },
                {
                    resource: {
                        buffer: createGPUBuffer(this.device, cubeNormalMatrix, GPUBufferUsage.UNIFORM, ""),
                    },
                    binding: 1,
                },
                {
                    resource: this.cubeMap.createView({ dimension: "cube" }),
                    binding: 2,
                },
                {
                    resource: cubeSampler,
                    binding: 3,
                },
            ],
        });

        this.cubePipeline = this.device.createRenderPipeline({
            label: "cube pipeline",
            vertex: {
                module: cubeModule,
                entryPoint: "vs",
                buffers: [
                    {
                        arrayStride: 6 * 4,
                        stepMode: "vertex",
                        attributes: [
                            {
                                offset: 0,
                                shaderLocation: 0,
                                format: "float32x4",
                            },
                            {
                                offset: 4 * 4,
                                shaderLocation: 1,
                                format: "float32x2",
                            },
                        ],
                    },
                ],
            },
            fragment: {
                module: cubeModule,
                entryPoint: "fs",
                targets: [{ format: this.defaultFormat }],
            },
            primitive: {
                topology: "triangle-list",
            },
            depthStencil: {
                depthCompare: "less",
                depthWriteEnabled: true,
                format: "depth24plus",
            },
            layout: this.device.createPipelineLayout({
                label: "main pipeline layout",
                bindGroupLayouts: [this.globalBindGroup.layout, cubeLayout],
            }),
        });
    }

    public render(): GPURenderBundle {
        const encoder = this.device.createRenderBundleEncoder({
            depthStencilFormat: "depth24plus",
            colorFormats: [this.defaultFormat],
        });

        encoder.setPipeline(this.cubePipeline as GPURenderPipeline);
        encoder.setBindGroup(0, this.globalBindGroup.bindGroup);
        encoder.setBindGroup(1, this.cubeBindGroup);
        encoder.setVertexBuffer(0, this.cubeVertexBuffer);
        encoder.draw(36);

        return encoder.finish();
    }
}
