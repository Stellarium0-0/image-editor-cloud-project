import React, { useState, useEffect, useCallback, ChangeEvent } from 'react';
import api from '../services/api';
import AuthenticatedImage from './AuthenticatedImage';

// --- (Interfaces remain the same) ---
interface ImageMetadata {
  unique_filename: string;
  original_filename: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  processed_versions: string[];
  user: string;
}

interface PaginatedImagesResponse {
  images: ImageMetadata[];
}

interface DashboardPageProps {
  username: string | null;
  onLogout: () => void;
}

interface ActivePreviews {
  [key: string]: string;
}

function DashboardPage({ username, onLogout }: DashboardPageProps) {
  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string>('');
  const [activePreviews, setActivePreviews] = useState<ActivePreviews>({});

  const fetchImages = useCallback(async () => {
    try {
      const response = await api.get<PaginatedImagesResponse>('/images');
      const initialPreviews: ActivePreviews = {};
      response.data.images.forEach(img => {
        const latestVersion = img.processed_versions.length > 0
          ? img.processed_versions[img.processed_versions.length - 1]
          : img.unique_filename;
        initialPreviews[img.unique_filename] = latestVersion;
      });
      setImages(response.data.images);
      setActivePreviews(initialPreviews);
    } catch (error) {
      console.error('Failed to fetch images:', error);
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setSelectedFile(e.target.files[0]);
  };

  const handleDelete = async (uniqueFilename: string) => {
    // Add a confirmation dialog before deleting
    if (!window.confirm("Are you sure you want to delete this image and all its processed versions?")) {
      return;
    }

    try {
      await api.delete(`/images/${uniqueFilename}`);
      // Refresh the image gallery to reflect the deletion
      fetchImages();
    } catch (error) {
      console.error("Failed to delete image:", error);
      setMessage("Failed to delete image.");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage('Please select a file to upload.');
      return;
    }
    const formData = new FormData();
    formData.append('image', selectedFile);
    try {
      await api.post('/images/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMessage('Image uploaded successfully!');
      setSelectedFile(null);
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      fetchImages();
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('Image upload failed.');
    }
  };

  const handleProcess = async (img: ImageMetadata, transformation: string) => {
    try {
      const sourceImage = activePreviews[img.unique_filename];
      const requestBody = {
        operations: [{ type: transformation }],
        source: sourceImage,
      };
      setMessage(`Applying ${transformation} effect...`);
      await api.post(`/images/${img.unique_filename}/process`, requestBody);
      setTimeout(() => {
        setMessage('');
        fetchImages();
      }, 3000);
    } catch (error) {
      console.error('Processing error:', error);
      setMessage('An error occurred during processing.');
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      setMessage("Preparing final image for download...");

      // Find the original image's unique filename to send to the process endpoint
      const currentImage = images.find(img =>
        img.unique_filename === filename || img.processed_versions.includes(filename)
      );

      if (!currentImage) {
        throw new Error("Could not find image metadata.");
      }

      // Step 1: Call the process endpoint to create a final, watermarked version
      const response = await api.post(`/images/${currentImage.unique_filename}/process`, {
        operations: [{ type: 'composite' }], // 'composite' is our watermark operation
        source: filename, // Apply the watermark to the currently selected preview
      });

      // After a short delay to allow processing, fetch the latest image data
      setTimeout(async () => {
        const updatedImagesResponse = await api.get<PaginatedImagesResponse>('/images');
        const updatedImage = updatedImagesResponse.data.images.find(img => img.unique_filename === currentImage.unique_filename);

        if (updatedImage && updatedImage.processed_versions.length > 0) {
          const finalWatermarkedFile = updatedImage.processed_versions[updatedImage.processed_versions.length - 1];

          // Step 2: Fetch the newly created watermarked image as a blob
          setMessage(`Downloading ${finalWatermarkedFile}...`);
          const fileResponse = await api.get(`/images/${finalWatermarkedFile}/file`, {
            responseType: 'blob',
          });

          // Step 3: Trigger the browser download
          const url = window.URL.createObjectURL(new Blob([fileResponse.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', 'processed-image.jpg'); // Generic download name
          document.body.appendChild(link);
          link.click();

          // Cleanup
          link.parentNode?.removeChild(link);
          window.URL.revokeObjectURL(url);
          setMessage('');
          fetchImages(); // Refresh the main gallery to show the new watermarked version
        }
      }, 3000); // 3-second delay for processing

    } catch (error) {
      console.error('Download error:', error);
      setMessage('Download failed.');
    }
  };

  const setActivePreview = (imageId: string, filename: string) => {
    setActivePreviews(prev => ({ ...prev, [imageId]: filename }));
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>Welcome, {username}!</h1>
        <button onClick={onLogout}>Logout</button>
      </header>
      <section className="upload-section">
        <h3>Upload a New Image</h3>
        <input type="file" id="file-input" onChange={handleFileChange} />
        <button onClick={handleUpload}>Upload</button>
        {message && <p>{message}</p>}
      </section>
      <section>
        <h2>My Image Gallery</h2>
        <div className="image-gallery">
          {images.map((img) => (
            <div key={img.unique_filename} className="image-card">
              <button className="delete-btn" onClick={() => handleDelete(img.unique_filename)}>
                &times;
              </button>
              <h4>{img.original_filename}</h4>
              <AuthenticatedImage
                src={`/images/${activePreviews[img.unique_filename]}/file`}
                alt="Active preview"
                className="main-preview-area"
              />
              <div className="previews-container">
                <div className="thumbnail-wrapper" onClick={() => setActivePreview(img.unique_filename, img.unique_filename)}>
                  <h5>Original</h5>
                  <AuthenticatedImage
                    src={`/images/${img.unique_filename}/file`}
                    alt="Original"
                    className={`thumbnail-img ${activePreviews[img.unique_filename] === img.unique_filename ? 'active' : ''}`}
                  />
                </div>
                {img.processed_versions.map((version, index) => (
                  <div className="thumbnail-wrapper" key={version} onClick={() => setActivePreview(img.unique_filename, version)}>
                    <h5>Effect {index + 1}</h5>
                    <AuthenticatedImage
                      src={`/images/${version}/file`}
                      alt={`Processed version ${index + 1}`}
                      className={`thumbnail-img ${activePreviews[img.unique_filename] === version ? 'active' : ''}`}
                    />
                  </div>
                ))}
              </div>
              <div className="image-actions-title">Apply Effect</div>
              <div className="image-actions">
                <button className="process-btn" onClick={() => handleProcess(img, 'grayscale')}>Grayscale</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'blur')}>Blur</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'sharpen')}>Sharpen</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'rotate')}>Rotate</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'tint')}>Tint</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'negate')}>Negate</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'convolve')}>Emboss</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'median')}>Median</button>
                <button className="process-btn" onClick={() => handleProcess(img, 'clahe')}>CLAHE</button>
                 <button className="process-btn" onClick={() => handleProcess(img, 'recomb')}>Recomb</button>
                 <button className="process-btn" onClick={() => handleProcess(img, 'glow')}>Glow</button>


                <button className="download-btn" onClick={() => handleDownload(activePreviews[img.unique_filename])}>Download Current</button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default DashboardPage;