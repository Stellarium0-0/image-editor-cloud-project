import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bodyParser from "body-parser";
import multer from "multer";
import sharp, { BoolEnum } from "sharp";
import fs from "fs";
import crypto from "crypto";
import cors from "cors";
import * as redis from "redis";
import path from "path";
import FormData from 'form-data'; 
import axios from "axios";
import dotenv from 'dotenv';
dotenv.config();

interface ImageOperation {
  type:
  | "sharpen"
  | "composite"
  | "tint"
  | "negate"
  | "convolve"
  | "median"
  | "recomb"
  | "fractal_noise"
  | "chromatic_aberration"
  | "oil_painting"
  | "holographic"
  | "edge_enhance_extreme"
  | "vortex"
  | "plasma"
  | "aurora"

  width?: number;
  height?: number;
  sigma?: number;
  angle?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: string | jwt.JwtPayload;
    }
  }
}

const app = express();

const PORT: number = 3001;

const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    const uploadsDir = "uploads/";
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }
    cb(null, uploadsDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb) => {
    const fileExtension = path.extname(file.originalname);
    const uniqueFilename = `${crypto
      .randomBytes(16)
      .toString("hex")}${fileExtension}`;
    cb(null, uniqueFilename);
  },
});
const upload = multer({ storage: storage });

const redisClient = redis.createClient({
  url: `redis://${process.env.NODE_ENV === "production" ? "redis" : "127.0.0.1"
    }:6379/0`,
});

redisClient.on("error", (err: Error) => console.log("Redis Client Error", err));

async function connectToRedis(): Promise<void> {
  await redisClient.connect();
  console.log("Connected to Redis!");
}
connectToRedis();

app.use(cors());
app.use(bodyParser.json());

const SECRET_KEY: string = "your_jwt_secret";

const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (token == null) return res.sendStatus(401);

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

app.post("/register", async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }

  const userExists = await redisClient.hExists("users", username);
  if (userExists) {
    return res.status(409).json({ message: "Username already taken." });
  }

  await redisClient.hSet("users", username, password);
  res.status(201).json({ message: "Account created successfully!" });
});

app.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const storedPassword = await redisClient.hGet("users", username);

  if (storedPassword && storedPassword === password) {
    if (typeof username === "string") {
      const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: "1h" });
      return res.json({ token, username });
    }
  }
  res.status(401).json({ message: "Invalid credentials" });
});

app.post(
  "/images/upload",
  authenticateToken,
  upload.single("image"),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided." });
    }

    const userPayload = req.user as { username: string };
    const user = userPayload.username;
    const originalFilename = req.file.originalname;
    const uniqueFilename = req.file.filename;

    try {
            const form = new FormData();
      form.append('image', fs.createReadStream(req.file.path));

      const imaggaResponse = await axios.post(
        'https://api.imagga.com/v2/tags',
        form,
        {
          headers: {
            ...form.getHeaders(),
            // Create Basic Auth header from your API keys
            'Authorization': 'Basic ' + Buffer.from(`${process.env.IMAGGA_API_KEY}:${process.env.IMAGGA_API_SECRET}`).toString('base64'),
          },
        }
      );

      // Extract the top 5 tags with confidence over 20
      const tags = imaggaResponse.data.result.tags
        .filter((tag: { confidence: number }) => tag.confidence > 20)
        .slice(0, 5)
        .map((tag: { tag: { en: string } }) => tag.tag.en);
      const imageId = `image:${uniqueFilename}`;
      await redisClient.hSet(imageId, {
        user,
        original_filename: originalFilename,
        unique_filename: uniqueFilename,
        status: "uploaded",
        processed_versions: JSON.stringify([]),
        tags: JSON.stringify(tags),
      });

      res.status(201).json({
        message:
          "Image uploaded successfully. Processing can now be triggered.",
        imageId,
      });
    } catch (err) {
      console.error("Error uploading image metadata to Redis:", err);
      res.status(500).json({ message: "Server error occurred during upload." });
    }
  }
);

app.post(
  "/images/:id/process",
  authenticateToken,
  async (req: Request, res: Response) => {
    const imageId = `image:${req.params.id}`;
    const userPayload = req.user as { username: string };

    const {
      operations,
      source,
    }: { operations: ImageOperation[]; source?: string } = req.body;

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return res
        .status(400)
        .json({ message: "Request body must contain an array of operations." });
    }

    const imageMetadata = await redisClient.hGetAll(imageId);

    if (
      !imageMetadata ||
      Object.keys(imageMetadata).length === 0 ||
      imageMetadata.user !== userPayload.username
    ) {
      return res
        .status(404)
        .json({ message: "Image not found or access denied." });
    }

    res.json({
      message: `Processing started with ${operations.length} operations.`,
    });

    (async () => {
      const sourceFilename = req.body.source || imageMetadata.unique_filename;
      const sourceImagePath = path.join("uploads", sourceFilename);
      const processedFilename = `processed-${crypto
        .randomBytes(8)
        .toString("hex")}-${imageMetadata.unique_filename}`;
      const processedPath = path.join("uploads", processedFilename);

      try {
        await redisClient.hSet(imageId, "status", "processing");
        let image = sharp(sourceImagePath);

        for (const op of operations) {
          switch (op.type) {

            case "sharpen":
              image = image.sharpen({ sigma: op.sigma || 2 });
              break;

            case "composite":
              image = image.composite([
                { input: "watermark.png", gravity: "southeast" },
              ]);
              break;

            case "tint":
              image = image.tint({ r: 255, g: 240, b: 150 }); //  Sepia-like tint
              break;
            case "negate":
              image = image.negate();
              break;
            case "convolve":
              image = image.convolve({
                width: 3,
                height: 3,
                kernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
              });
              break;
            case "median":
              image = image.median(10);
              break;
            case "recomb":
              image = image.recomb([
                [0.2126, 0.7152, 0.0722],
                [0.2126, 0.7152, 0.0722],
                [0.2126, 0.7152, 0.0722],
              ]);
              break;

            case "fractal_noise":
              // Creates a fractal noise overlay - very computationally expensive
              const { width: imgWidth, height: imgHeight } = await image.metadata();
              const noiseWidth = imgWidth || 800;
              const noiseHeight = imgHeight || 800;
              const noiseBuffer = Buffer.alloc(noiseWidth * noiseHeight * 3);
              for (let y = 0; y < noiseHeight; y++) {
                for (let x = 0; x < noiseWidth; x++) {
                  const idx = (y * noiseWidth + x) * 3;
                  const noise1 = Math.sin(x * 0.02) * Math.sin(y * 0.02);
                  const noise2 = Math.sin(x * 0.04) * Math.sin(y * 0.03);
                  const noise3 = Math.sin(x * 0.01) * Math.sin(y * 0.015);
                  const finalNoise = (noise1 + noise2 * 0.5 + noise3 * 0.25) * 127 + 128;

                  noiseBuffer[idx] = Math.max(0, Math.min(255, finalNoise));
                  noiseBuffer[idx + 1] = Math.max(0, Math.min(255, finalNoise * 0.8));
                  noiseBuffer[idx + 2] = Math.max(0, Math.min(255, finalNoise * 0.6));
                }
              }

              const noiseImage = await sharp(noiseBuffer, {
                raw: { width: noiseWidth, height: noiseHeight, channels: 3 }
              }).png().toBuffer();

              image = image.composite([{ input: noiseImage, blend: 'overlay' }]);
              break;

            case "chromatic_aberration":
              // Simulates lens chromatic aberration - very cool effect
              const metadata = await image.metadata();
              const originalBuffer = await image.toBuffer();

              // Create red, green, blue channel shifts
              const redShift = sharp(originalBuffer)
                .extractChannel('red')
                .resize(metadata.width! + 4, metadata.height! + 4)
                .extract({ left: 2, top: 2, width: metadata.width!, height: metadata.height! });

              const greenChannel = sharp(originalBuffer).extractChannel('green');

              const blueShift = sharp(originalBuffer)
                .extractChannel('blue')
                .resize(metadata.width! - 4, metadata.height! - 4)
                .resize(metadata.width!, metadata.height!);

              // Recombine with shifts
              image = sharp({
                create: {
                  width: metadata.width!,
                  height: metadata.height!,
                  channels: 3,
                  background: { r: 0, g: 0, b: 0 }
                }
              }).composite([
                { input: await redShift.toBuffer(), blend: 'lighten' },
                { input: await greenChannel.toBuffer(), blend: 'lighten' },
                { input: await blueShift.toBuffer(), blend: 'lighten' }
              ]);
              break;

            case "oil_painting":
              // Oil painting effect using multiple convolutions 
              const oilKernel1 = [
                1, 1, 1, 1, 1,
                1, 2, 2, 2, 1,
                1, 2, 4, 2, 1,
                1, 2, 2, 2, 1,
                1, 1, 1, 1, 1
              ];

              image = image
                .convolve({ width: 5, height: 5, kernel: oilKernel1, scale: 36 })
                .median(3)
                .sharpen({ sigma: 2, m1: 2, m2: 3 })
                .modulate({ saturation: 1.3, lightness: 1.1 });
              break;

            case "holographic":
              // Creates a holographic rainbow effect
              const holoMetadata = await image.metadata();
              const holoWidth = holoMetadata.width || 800;
              const holoHeight = holoMetadata.height || 800;
              const holoBuffer = Buffer.alloc(holoWidth * holoHeight * 3);

              for (let y = 0; y < holoHeight; y++) {
                for (let x = 0; x < holoWidth; x++) {
                  const idx = (y * holoWidth + x) * 3;
                  const wave = Math.sin((x + y) * 0.1) * 0.5 + 0.5;
                  holoBuffer[idx] = Math.max(0, Math.min(255, Math.sin(wave * Math.PI * 2) * 127 + 128));     // R
                  holoBuffer[idx + 1] = Math.max(0, Math.min(255, Math.sin(wave * Math.PI * 2 + 2.09) * 127 + 128)); // G
                  holoBuffer[idx + 2] = Math.max(0, Math.min(255, Math.sin(wave * Math.PI * 2 + 4.19) * 127 + 128)); // B
                }
              }

              // Convert raw buffer to PNG buffer before compositing
              const holoOverlay = await sharp(holoBuffer, {
                raw: { width: holoWidth, height: holoHeight, channels: 3 }
              }).png().toBuffer();

              image = image.composite([{ input: holoOverlay, blend: 'screen' }]);
              break;

            case "edge_enhance_extreme":
              // Extreme edge enhancement with multiple passes
              const edgeKernel1 = [-1, -1, -1, -1, -1, -1, -1,
              -1, -2, -2, -2, -2, -2, -1,
              -1, -2, -3, -3, -3, -2, -1,
              -1, -2, -3, 24, -3, -2, -1,
              -1, -2, -3, -3, -3, -2, -1,
              -1, -2, -2, -2, -2, -2, -1,
              -1, -1, -1, -1, -1, -1, -1];

              const edgeKernel2 = [-1, -1, -1,
              -1, 8, -1,
              -1, -1, -1];

              image = image
                .convolve({ width: 7, height: 7, kernel: edgeKernel1 })
                .normalize()
                .convolve({ width: 3, height: 3, kernel: edgeKernel2 })
                .linear(1.8, 10)
                .gamma(1.2)
                .sharpen({ sigma: 3, m1: 2, m2: 3 });
              break;

            case "vortex":
              // Creates a swirl/vortex effect by manipulating pixel coordinates
              const vortexMeta = await image.metadata();
              const vortexWidth = vortexMeta.width || 800;
              const vortexHeight = vortexMeta.height || 800;
              const centerX = vortexWidth / 2;
              const centerY = vortexHeight / 2;
              const maxRadius = Math.min(centerX, centerY);

              // This is computationally expensive - we'll simulate with multiple rotations
              const segments = 8;
              let composites = [];

              for (let i = 0; i < segments; i++) {
                const angle = (360 / segments) * i;
                const radius = (maxRadius / segments) * (i + 1);

                const segment = sharp(await image.clone().toBuffer())
                  .resize(Math.floor(vortexWidth * (1 - i * 0.1)),
                    Math.floor(vortexHeight * (1 - i * 0.1)))
                  .rotate(angle * (i + 1))
                  .resize(vortexWidth, vortexHeight);

                composites.push({
                  input: await segment.toBuffer(),
                  blend: (i === 0 ? 'over' : 'multiply') as sharp.Blend,
                  opacity: 1 / (i + 1)
                });
              }

              image = sharp({
                create: { width: vortexWidth, height: vortexHeight, channels: 3, background: 'black' }
              }).composite(composites);
              break;




            case "plasma":
              // Generates plasma-like effect
              const plasmaMeta = await image.metadata();
              const plasmaWidth = plasmaMeta.width || 800;
              const plasmaHeight = plasmaMeta.height || 800;
              const plasmaBuffer = Buffer.alloc(plasmaWidth * plasmaHeight * 3);

              for (let y = 0; y < plasmaHeight; y++) {
                for (let x = 0; x < plasmaWidth; x++) {
                  const idx = (y * plasmaWidth + x) * 3;

                  const plasma = Math.sin(x * 0.04) +
                    Math.sin(y * 0.03) +
                    Math.sin((x + y) * 0.02) +
                    Math.sin(Math.sqrt(x * x + y * y) * 0.02);

                  plasmaBuffer[idx] = Math.max(0, Math.min(255, (Math.sin(plasma) + 1) * 127.5));     // R
                  plasmaBuffer[idx + 1] = Math.max(0, Math.min(255, (Math.sin(plasma + 2) + 1) * 127.5)); // G
                  plasmaBuffer[idx + 2] = Math.max(0, Math.min(255, (Math.sin(plasma + 4) + 1) * 127.5)); // B
                }
              }

              const plasmaImage = await sharp(plasmaBuffer, {
                raw: { width: plasmaWidth, height: plasmaHeight, channels: 3 }
              }).png().toBuffer();

              image = image.composite([{ input: plasmaImage, blend: 'multiply' }]);
              break;
            case "aurora":
              const auroraMeta = await image.metadata();
              const auroraWidth = auroraMeta.width || 800;
              const auroraHeight = auroraMeta.height || 600;
              const auroraBuffer = Buffer.alloc(auroraWidth * auroraHeight * 4); // RGBA for transparency

              for (let y = 0; y < auroraHeight; y++) {
                for (let x = 0; x < auroraWidth; x++) {
                  const idx = (y * auroraWidth + x) * 4;
                  let alpha = 0;

                  const noise1 = Math.sin(y * 0.01 + x * 0.005 + Date.now() * 0.0001) * 0.5 + 0.5;
                  const noise2 = Math.sin(y * 0.015 - x * 0.003 + Date.now() * 0.00015) * 0.5 + 0.5;
                  const noise3 = Math.sin(y * 0.008 + x * 0.007 + Date.now() * 0.0002) * 0.5 + 0.5;

                  const band1 = Math.pow(Math.abs(Math.sin(y * 0.02 + Date.now() * 0.00005) * 5), 5) * 300;
                  const band2 = Math.pow(Math.abs(Math.sin((y + 50) * 0.025 + Date.now() * 0.00007) * 5), 5) * 300;
                  const band3 = Math.pow(Math.abs(Math.sin((y + 100) * 0.018 + Date.now() * 0.00009) * 5), 5) * 300;

                  const intensity = (band1 + band2 * 0.8 + band3 * 0.6) / (auroraHeight * 3); // Normalize

                  if (intensity > 0.008) {
                    alpha = Math.min(0.6, intensity * 5); // Adjusted alpha for more transparency

                    const r = Math.max(0, Math.min(255, (0.8 * noise1 + 0.2) * 255)); // Orange/Pink
                    const g = Math.max(0, Math.min(255, (0.3 * noise2) * 255)); // Subtle Green/Yellow
                    const b = Math.max(0, Math.min(255, (0.5 * noise3 + 0.5) * 255)); // Purple/Blue

                    auroraBuffer.writeUInt8(r, idx);
                    auroraBuffer.writeUInt8(g, idx + 1);
                    auroraBuffer.writeUInt8(b, idx + 2);
                    auroraBuffer.writeUInt8(Math.floor(alpha * 255), idx + 3);
                  } else {
                    auroraBuffer.writeUInt32BE(0, idx); // Fully transparent if intensity is low
                  }
                }
              }

              const auroraImage = await sharp(auroraBuffer, {
                raw: { width: auroraWidth, height: auroraHeight, channels: 4 },
              }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

              image = image.composite([{ input: auroraImage, blend: 'soft-light' }]);
              break;


          }
        }

        await image.toFile(processedPath);

        // --- FIX 1: CORRECTLY UPDATE THE 'processed_versions' ARRAY ---
        const existingVersions = JSON.parse(
          imageMetadata.processed_versions || "[]"
        );
        existingVersions.push(processedFilename);

        await redisClient.hSet(imageId, {
          status: "completed",
          processed_versions: JSON.stringify(existingVersions),
        });

        console.log(`Image ${imageId} processed successfully.`);
      } catch (err) {
        console.error(`Error processing image ${imageId}:`, err);
        await redisClient.hSet(imageId, "status", "failed");
      }
    })();
  }
);

app.get("/images", authenticateToken, async (req: Request, res: Response) => {
  const userPayload = req.user as { username: string };
  const user = userPayload.username;

  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const sortBy: string = (req.query.sortBy as string) || "original_filename";
  const order: number = req.query.order === "desc" ? -1 : 1;
  const startIndex = (page - 1) * limit;

  try {
    const imageKeys = await redisClient.keys("image:*");
    let userImages: any[] = [];

    for (const key of imageKeys) {
      const metadata = await redisClient.hGetAll(key);
      if (metadata.user === user) {
        metadata.processed_versions = JSON.parse(
          metadata.processed_versions || "[]"
        );
        userImages.push(metadata);
      }
    }
    userImages.sort((a, b) => {
      if (a[sortBy] < b[sortBy]) return -1 * order;
      if (a[sortBy] > b[sortBy]) return 1 * order;
      return 0;
    });

    const paginatedImages = userImages.slice(startIndex, startIndex + limit);

    res.json({
      totalImages: userImages.length,
      totalPages: Math.ceil(userImages.length / limit),
      currentPage: page,
      images: paginatedImages,
    });
  } catch (err) {
    console.error("Error fetching images:", err);
    res.status(500).json({ message: "Server error while fetching images." });
  }
});

app.get(
  "/images/:filename/file",
  authenticateToken,
  async (req: Request, res: Response) => {
    const filename = req.params.filename;
    const filePath = path.resolve("./uploads", filename);

    if (path.dirname(filePath) !== path.resolve("./uploads")) {
      return res.status(403).send("Forbidden");
    }

    res.sendFile(filePath, (err) => {
      if (err) {
        res.status(404).send("File not found.");
      }
    });
  }
);

app.delete(
  "/images/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    const imageId = `image:${req.params.id}`;
    const userPayload = req.user as { username: string };

    try {
      const imageMetadata = await redisClient.hGetAll(imageId);

      if (!imageMetadata || imageMetadata.user !== userPayload.username) {
        return res
          .status(404)
          .json({ message: "Image not found or access denied." });
      }

      // Delete all associated files from the 'uploads' directory
      const filesToDelete = [
        imageMetadata.unique_filename,
        ...JSON.parse(imageMetadata.processed_versions || "[]"),
      ];

      filesToDelete.forEach((filename) => {
        if (filename) {
          // Ensure filename is not empty
          const filePath = path.resolve("./uploads", filename);
          fs.unlink(filePath, (err) => {
            if (err) console.error(`Failed to delete file ${filename}:`, err);
          });
        }
      });

      // Delete the image record from Redis
      await redisClient.del(imageId);

      res
        .status(200)
        .json({ message: "Image and all its versions deleted successfully." });
    } catch (error) {
      console.error("Error deleting image:", error);
      res.status(500).json({ message: "Server error during deletion." });
    }
  }
);

const frontendPath = path.join(__dirname, "..", "frontend", "build");
app.use(express.static(frontendPath));

app.get(/^(?!\/api).*/, (req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
