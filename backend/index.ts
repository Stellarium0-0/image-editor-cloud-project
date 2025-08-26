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

interface ImageOperation {
  type:
    | "resize"
    | "blur"
    | "sharpen"
    | "rotate"
    | "composite"
    | "grayscale"
    | "tint"
    | "negate"
    | "convolve"
    | "median"
    | "clahe"
    | "recomb"
    | "boolean"
    | "glow";

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
  url: `redis://${
    process.env.NODE_ENV === "production" ? "redis" : "127.0.0.1"
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
      const imageId = `image:${uniqueFilename}`;
      await redisClient.hSet(imageId, {
        user,
        original_filename: originalFilename,
        unique_filename: uniqueFilename,
        status: "uploaded",
        processed_versions: JSON.stringify([]),
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
            case "resize":
              image = image.resize({
                width: op.width || 800,
                height: op.height || 800,
                fit: "cover",
                kernel: sharp.kernel.lanczos3,
              });
              break;
            case "blur":
              image = image.blur(op.sigma || 10);
              break;
            case "sharpen":
              image = image.sharpen({ sigma: op.sigma || 2 });
              break;
            case "rotate":
              image = image.rotate(op.angle || 90);
              break;
            case "composite":
              image = image.composite([
                { input: "watermark.png", gravity: "southeast" },
              ]);
              break;
            case "grayscale":
              image = image.grayscale();
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

            case "clahe":
              image = image.clahe({ width: 200, height: 200 });
              break;
            case "recomb":
              image = image.recomb([
                [0.2126, 0.7152, 0.0722],
                [0.2126, 0.7152, 0.0722],
                [0.2126, 0.7152, 0.0722],
              ]);
              break;
                case "glow":
  
      image = image.convolve({
        width: 7,
        height: 7,
        kernel: [
          1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1,
          1, 1, 1, 1, 1, 1, 1,
        ],
        scale: 49, 
      });
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
