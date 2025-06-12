import {Accessor, Document, Material, Mesh, Root, Node, TypedArray, WebIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {quat, vec3} from 'gl-matrix';
import {AttributeData, GeometryData, LODRange} from "./loaderTypes.ts";
import {SceneObject} from "../SceneObject/sceneObject.ts";
import {generateID} from "../../helpers/global.helper.ts";

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);

/** A GLTF/GLB loader class with optional caching and progress reporting. */
export class GLTFLoader {
    /**
     * Loads a model from URL and returns document, meshes, buffers, and animations.
     */
    public async load(url: string): Promise<{
        document: Document;
        buffers: any[];
        root: Root,
        sceneObjects: Set<SceneObject>
    }> {
        let document = await io.read(url);

        const root = document.getRoot();

        const sceneObjects: Set<SceneObject> = new Set();
        const nodeToSceneObject = new Map<Node, SceneObject>();

        for (const node of root.listNodes()) {
            const translation = node.getTranslation();
            const rotation = node.getRotation();
            const scale = node.getScale();
            const mesh = node.getMesh();

            const sceneObject = new SceneObject({
                id: generateID(),
                name: node.getName(),
                nodeIndex: root.listNodes().indexOf(node),
                translation: vec3.fromValues(...translation),
                rotation: quat.fromValues(...rotation),
                scale: vec3.fromValues(...scale),
                mesh: mesh ?? undefined,
                worldPosition: node.getWorldMatrix() ?? undefined,
                primitivesData: mesh ? await this.extractGeometry(mesh) : undefined,
            });

            nodeToSceneObject.set(node, sceneObject);
            sceneObjects.add(sceneObject);
        }

        for (const node of root.listNodes()) {
            const sceneObject = nodeToSceneObject.get(node);
            const parentNode = node.getParentNode();
            if (parentNode) {
                const parentSceneObject = nodeToSceneObject.get(parentNode);
                if (parentSceneObject && sceneObject) {
                    sceneObject.parent = parentSceneObject;
                    parentSceneObject.children.push(sceneObject);
                }
            }
        }

        const buffers = root.listBuffers();
        const result = {
            document,
            sceneObjects,
            buffers,
            root,
        };

        return result;
    }


    private async extractGeometry(mesh: Mesh): Promise<GeometryData[]> {

        const primitives = mesh.listPrimitives();

        const geometryData: GeometryData[] = [];
        for (const prim of primitives) {

            const semantics = prim.listSemantics();
            let lodRanges: LODRange[] = [{
                start: 0,
                count: prim.listAttributes()[semantics.indexOf('POSITION')].getArray()?.length ?? 0,
            }];
            if (prim.getExtras().lodRanges) {
                lodRanges = prim.getExtras().lodRanges as LODRange[];
            }
            const uniforms: Map<string, AttributeData> = new Map();

            prim.listAttributes().forEach((accessor: Accessor, i: number) => {
                let array = accessor.getArray() as TypedArray;
                const type = accessor.getType() as string;
                const itemSize =
                    type === 'SCALAR' ? 1 :
                        type === 'VEC2' ? 2 :
                            type === 'VEC3' ? 3 :
                                type === 'VEC4' ? 4 : array.length;
                const name = semantics[i];
                if (name === "JOINTS_0" && array instanceof Uint16Array) {
                    array = new Uint32Array(array)
                }
                uniforms.set(name, {array, itemSize});
            });
            const indexAcc = prim.getIndices();
            let indices: TypedArray | undefined = indexAcc?.getArray() ?? undefined;
            let indexType: "uint16" | "uint32" | "Unknown" =
                indices instanceof Uint16Array ? 'uint16' :
                    'uint32';
            let correctedIndices;
            if (indexType === "uint16" && indices && indices.byteLength % 4 !== 0) {
                correctedIndices = new Uint32Array(indices.length);
                correctedIndices.set(indices)
                indexType = "uint32"
            }

            geometryData.push({
                dataList: uniforms,
                indices: indices ? indices.byteLength % 4 !== 0 ? correctedIndices : indices : undefined,
                indexType,
                lodRanges: lodRanges,
                indexCount: indices?.length ?? 0,
                material: prim.getMaterial() as Material,
                id: generateID()
            });
        }
        return geometryData;
    }
}