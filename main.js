
// after https://github.com/austinEng/webgpu-samples/blob/master/src/examples/rotatingCube.ts


import {LASLoader} from './LASLoader.js';
import { mat4, vec3 } from './libs/gl-matrix.js';
import {cube, pointCube} from "./cube.js";
import * as shaders from "./shaders.js";

//let urlPointcloud = "http://mschuetz.potree.org/lion/lion.las";
let urlPointcloud = "./heidentor.las";

let adapter = null;
let device = null;
let canvas = null;
let context = null;
let swapChain = null;
let depthTexture = null;

let scene = {
	pointcloud: null,
};

let aspect = 3 / 4;
let projectionMatrix = mat4.create();
mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 0.1, 1000.0);

function getTransformationMatrix() {

	aspect = canvas.clientWidth / canvas.clientHeight;
	mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 0.1, 1000.0);

	let viewMatrix = mat4.create();
	mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -20));
	let now = Date.now() / 1000;

	mat4.rotate(
		viewMatrix,
		viewMatrix,
		now,
		vec3.fromValues(0, 1, 0)
	);

	let modelViewProjectionMatrix = mat4.create();
	mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

	return modelViewProjectionMatrix;
}


async function init(){
	adapter = await navigator.gpu.requestAdapter();
	device = await adapter.requestDevice();

	canvas = document.getElementById("canvas");
	context = canvas.getContext("gpupresent");

	swapChain = context.configureSwapChain({
		device,
		format: "bgra8unorm",
	});

	depthTexture = device.createTexture({
		size: {
			width: canvas.width,
			height: canvas.height,
			depth: 1,
		},
		format: "depth24plus-stencil8",
		usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
	});

}

async function initScene(){
	let loader = new LASLoader(urlPointcloud);
	await loader.loadHeader();

	let numPoints = loader.header.numPoints;

	let descriptorPos = {
		size: 12 * numPoints,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	};
	let bufPositions = device.createBuffer(descriptorPos);

	let descriptorCol = {
		size: 16 * numPoints,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	};
	let bufColors = device.createBuffer(descriptorCol);

	let sceneObject = {
		n: 0,
		bufPositions: bufPositions,
		bufColors: bufColors,
	};

	let elProgress = document.getElementById("progress");

	let pipeline = device.createComputePipeline({
		computeStage: {
			module: device.createShaderModule({code: shaders.csLasToVBO}),
			entryPoint: "main",
		}
	});

	let asyncLoad = async () => {
		let iterator = loader.loadBatches();
		let pointsLoaded = 0;
		for await (let batch of iterator){


			let lasbuffer = device.createBuffer({
				size: batch.size * 64,
				usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
				// mappedAtCreation: true,
			});

			// new Uint8Array(lasbuffer.getMappedRange()).set(batch.buffer);
			// lasbuffer.unmap();

			let tmp = new Uint8Array(batch.size * 64);
			tmp.set(new Uint8Array(batch.buffer));
			device.defaultQueue.writeBuffer(lasbuffer, 0, tmp);


			if(pointsLoaded === 0){
				let csBindGroup = device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [{
						binding: 0,
						resource: {
							buffer: lasbuffer,
							offset: 0,
							size: batch.size * 64,
						}
					},{
						binding: 1,
						resource: {
							buffer: bufPositions,
							offset: 0,
							size: bufPositions.byteLength,
						}
					},{
						binding: 2,
						resource: {
							buffer: bufColors,
							offset: 0,
							size: bufColors.byteLength,
						}
					}],
				});

				const commandEncoder = device.createCommandEncoder();

				let passEncoder = commandEncoder.beginComputePass();
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, csBindGroup);
				passEncoder.dispatch(batch.size);
				passEncoder.endPass();

				device.defaultQueue.submit([commandEncoder.finish()]);
			}else{
				device.defaultQueue.writeBuffer(bufPositions, 12 * pointsLoaded, batch.positions);
				device.defaultQueue.writeBuffer(bufColors, 16 * pointsLoaded, batch.colors);
			}






			pointsLoaded += batch.size;

			let progress = pointsLoaded / loader.header.numPoints;
			let strProgress = `${parseInt(progress * 100)}`;
			let msg = `loading: ${strProgress}%`;
			elProgress.innerHTML = msg;

			sceneObject.n = pointsLoaded;
		}

		elProgress.innerHTML = `loading finished`;
	};

	asyncLoad();

	scene.pointcloud = sceneObject;
}

function createBuffer(data){

	let vbos = [];

	for(let entry of data.buffers){
		let {name, buffer} = entry;

		let vbo = device.createBuffer({
			size: buffer.byteLength,
			usage: GPUBufferUsage.VERTEX,
			mappedAtCreation: true,
		});

		let type = buffer.constructor;
		new type(vbo.getMappedRange()).set(buffer);
		vbo.unmap();

		vbos.push({
			name: name,
			vbo: vbo,
		});
	}

	return vbos;
}

function createPipeline(vbos){

	const pipeline = device.createRenderPipeline({
		vertexStage: {
			module: device.createShaderModule({code: shaders.vs}),
			entryPoint: "main",
		},
		fragmentStage: {
			module: device.createShaderModule({code: shaders.fs}),
			entryPoint: "main",
		},
		primitiveTopology: "point-list",
		depthStencilState: {
			depthWriteEnabled: true,
			depthCompare: "less",
			format: "depth24plus-stencil8",
		},
		vertexState: {
			vertexBuffers: [
				{ // position
					arrayStride: 3 * 4,
					attributes: [{ 
						shaderLocation: 0,
						offset: 0,
						format: "float3",
					}],
				},{ // color
					arrayStride: 4 * 4,
					attributes: [{ 
						shaderLocation: 1,
						offset: 0,
						format: "float4",
					}],
				},
			],
		},
		rasterizationState: {
			cullMode: "none",
		},
		colorStates: [
			{
				format: "bgra8unorm",
			},
		],
	});

	return pipeline;
}


function createComputeLasToVboPipeline(){
	let pipeline = device.createComputePipeline({
		computeStage: {
			module: device.createShaderModule({code: shaders.csLasToVBO}),
			entryPoint: "main",
		}
	});

	return pipeline;
}

function createComputePipeline(){
	let pipeline = device.createComputePipeline({
		computeStage: {
			module: device.createShaderModule({code: shaders.csTest}),
			entryPoint: "main",
		}
	});

	return pipeline;
}

async function run(){

	await init()
	initScene();

	let vbos = createBuffer(pointCube);
	let pipeline = createPipeline();
	let csPipeline = createComputePipeline();
	let csLasToVboPipeline = createComputeLasToVboPipeline();

	const uniformBufferSize = 4 * 16; // 4x4 matrix

	const uniformBuffer = device.createBuffer({
		size: uniformBufferSize,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});

	const uniformBindGroup = device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
		{
			binding: 0,
			resource: {
			buffer: uniformBuffer,
			},
		},
		],
	});





	let frame = 0;
	let loop = () => {
		frame++;

		const transformationMatrix = getTransformationMatrix();
		device.defaultQueue.writeBuffer(
			uniformBuffer,
			0,
			transformationMatrix.buffer,
			transformationMatrix.byteOffset,
			transformationMatrix.byteLength
		);

		let renderPassDescriptor = {
			colorAttachments: [
				{
					attachment: swapChain.getCurrentTexture().createView(),
					loadValue: { r: 0.5, g: 0.5, b: 0.5, a: 1.0 },
				},
			],
			depthStencilAttachment: {
				attachment: depthTexture.createView(),

				depthLoadValue: 1.0,
				depthStoreOp: "store",
				stencilLoadValue: 0,
				stencilStoreOp: "store",
			},
		};

		if(scene.pointcloud){

			let csBindGroup = device.createBindGroup({
				layout: csPipeline.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: {
						buffer: scene.pointcloud.bufPositions,
						offset: 0,
						size: 16 * 1_000_000,
					}
				},{
					binding: 1,
					resource: {
						buffer: scene.pointcloud.bufColors,
						offset: 0,
						size: 16 * 1_000_000,
					}
				}],
			});

			const commandEncoder = device.createCommandEncoder();

			// if(frame > 10){
			// 	let passEncoder = commandEncoder.beginComputePass();
			// 	passEncoder.setPipeline(csPipeline);
			// 	passEncoder.setBindGroup(0, csBindGroup);
			// 	passEncoder.dispatch(100_000);
			// 	passEncoder.endPass();
			// }

			{
				let passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
				passEncoder.setPipeline(pipeline);
				passEncoder.setBindGroup(0, uniformBindGroup);

				passEncoder.setVertexBuffer(0, scene.pointcloud.bufPositions);
				passEncoder.setVertexBuffer(1, scene.pointcloud.bufColors);

				//for(let i = 0; i < vbos.length; i++){
				//	passEncoder.setVertexBuffer(i, vbos[i].vbo);
				//}

				passEncoder.draw(scene.pointcloud.n, 1, 0, 0);
				passEncoder.endPass();
			}

			device.defaultQueue.submit([commandEncoder.finish()]);
		}

		requestAnimationFrame(loop);
	}
	loop();

}

run();


