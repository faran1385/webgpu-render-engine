import { mat4 } from "gl-matrix";

export interface BoundsRendererOptions {
    device: GPUDevice;
    format: GPUTextureFormat;
}

/**
 * Renders the light-camera orthographic frustum bounds as a colored wireframe box,
 * transformed by your scene camera. Near plane, far plane, and connectors are drawn
 * in different colors to indicate orientation and extents.
 */
export class OrthographicBoundsRenderer {
    private device: GPUDevice;
    private pipeline: GPURenderPipeline;
    private nearBuffer: GPUBuffer;
    private farBuffer: GPUBuffer;
    private connectorBuffer: GPUBuffer;
    private matrixBuffer: GPUBuffer;
    private colorBuffer: GPUBuffer;
    private bindGroup: GPUBindGroup;

    // 4 edges per plane * 2 verts = 8 verts
    private readonly sectionVerts = 8;

    constructor(options: BoundsRendererOptions) {
        this.device = options.device;

        // Scene camera MVP uniform
        this.matrixBuffer = this.device.createBuffer({
            size: 16 * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        // Color uniform
        this.colorBuffer = this.device.createBuffer({
            size: 4 * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.createPipeline(options.format);

        // Buffers for each section
        const bufSize = this.sectionVerts * 3 * Float32Array.BYTES_PER_ELEMENT;
        this.nearBuffer = this.device.createBuffer({ size: bufSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        this.farBuffer = this.device.createBuffer({ size: bufSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        this.connectorBuffer = this.device.createBuffer({ size: bufSize, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

        const layout = this.pipeline.getBindGroupLayout(0);
        this.bindGroup = this.device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: this.matrixBuffer } },
                { binding: 1, resource: { buffer: this.colorBuffer } },
            ],
        });
    }

    private createPipeline(format: GPUTextureFormat) {
        const vs = this.device.createShaderModule({ code: `
      @binding(0) @group(0) var<uniform> mvp : mat4x4<f32>;
      @vertex
      fn vs_main(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
        return mvp * vec4<f32>(pos, 1.0);
      }
    ` });
        const fs = this.device.createShaderModule({ code: `
      @binding(1) @group(0) var<uniform> color : vec4<f32>;
      @fragment
      fn fs_main() -> @location(0) vec4<f32> { return color; }
    ` });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: vs,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
                }],
            },
            fragment: { module: fs, entryPoint: 'fs_main', targets: [{ format }] },
            primitive: { topology: 'line-list' },
        });
    }

    /**
     * Draw the light camera's frustum box with colored sections.
     * @param pass - GPURenderPassEncoder
     * @param sceneView - scene camera view matrix
     * @param sceneProj - scene camera projection matrix
     * @param lightView - light view matrix from mat4.lookAt()
     * @param bounds - { left, right, top, bottom, near, far }
     */
    public draw(
        pass: GPURenderPassEncoder,
        sceneView: mat4,
        sceneProj: mat4,
        lightView: mat4,
        bounds: { left: number; right: number; top: number; bottom: number; near: number; far: number }
    ) {
        const { left, right, top, bottom, near, far } = bounds;
        // Light-space corners
        const ls = [
            [left, top, -near], [right, top, -near], [right, bottom, -near], [left, bottom, -near],
            [left, top, -far],  [right, top, -far],  [right, bottom, -far],  [left, bottom, -far]
        ];
        // Invert lightView
        const inv = mat4.invert(mat4.create(), lightView)!;
        const wc = ls.map(([x,y,z]) => {
            const v = [ x, y, z, 1 ];
            const r = [
                inv[0]*v[0] + inv[4]*v[1] + inv[8]*v[2]  + inv[12]*v[3],
                inv[1]*v[0] + inv[5]*v[1] + inv[9]*v[2]  + inv[13]*v[3],
                inv[2]*v[0] + inv[6]*v[1] + inv[10]*v[2] + inv[14]*v[3],
                inv[3]*v[0] + inv[7]*v[1] + inv[11]*v[2] + inv[15]*v[3]
            ];
            return [r[0]/r[3], r[1]/r[3], r[2]/r[3]];
        });

        // Sections: near edges, far edges, connectors
        const buildSection = (indices: number[]) => {
            const arr: number[] = [];
            for (const [a,b] of indices) {
                arr.push(...wc[a], ...wc[b]);
            }
            return new Float32Array(arr);
        };
        const nearIdx = [[0,1],[1,2],[2,3],[3,0]];
        const farIdx  = [[4,5],[5,6],[6,7],[7,4]];
        const conIdx  = [[0,4],[1,5],[2,6],[3,7]];

        // Write each buffer
        this.device.queue.writeBuffer(this.nearBuffer,     0, buildSection(nearIdx).buffer);
        this.device.queue.writeBuffer(this.farBuffer,      0, buildSection(farIdx ).buffer);
        this.device.queue.writeBuffer(this.connectorBuffer,0, buildSection(conIdx ).buffer);

        // Scene MVP
        const mvp = mat4.multiply(mat4.create(), sceneProj, sceneView);
        this.device.queue.writeBuffer(this.matrixBuffer, 0, new Float32Array(mvp as unknown as number[]).buffer);

        pass.setPipeline(this.pipeline);

        // Near plane (red)
        this.device.queue.writeBuffer(this.colorBuffer,0,new Float32Array([1,0,0,1]).buffer);
        pass.setBindGroup(0,this.bindGroup);
        pass.setVertexBuffer(0,this.nearBuffer);
        pass.draw(this.sectionVerts);

        // Far plane (blue)
        this.device.queue.writeBuffer(this.colorBuffer,0,new Float32Array([0,0,1,1]).buffer);
        pass.setBindGroup(0,this.bindGroup);
        pass.setVertexBuffer(0,this.farBuffer);
        pass.draw(this.sectionVerts);

        // Connectors (green)
        this.device.queue.writeBuffer(this.colorBuffer,0,new Float32Array([0,1,0,1]).buffer);
        pass.setBindGroup(0,this.bindGroup);
        pass.setVertexBuffer(0,this.connectorBuffer);
        pass.draw(this.sectionVerts);
    }
}
