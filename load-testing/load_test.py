import requests
import threading
import time
import os

# --- Configuration ---
BASE_URL = "http://localhost:3001"
TEST_USERNAME = "testuser"
TEST_PASSWORD = "testpassword"
IMAGE_PATH = "test_image.jpg"  # Our Test Image
CONCURRENT_REQUESTS = 20      # Number of parallel requests to send
TEST_DURATION_SECONDS = 300   # Run the test for 5 minutes

CPU_payload = {
    "operations": [
        {"type": "resize", "width": 1920, "height": 1080},
        {"type": "blur", "sigma": 15},
        {"type": "convolve"},
        {"type": "tint"},
        {"type": "composite"},
        {"type": "sharpen", "sigma": 3},
        {"type": "composite"}
    ]
}


jwt_token = ""
image_id = ""

def register_and_login():
    """Register a new user and log in to get a JWT."""
    global jwt_token
    print("--- Step 1: Registering and Logging In ---")
    try:
        # Register a new user 
        requests.post(f"{BASE_URL}/register", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        
        # Log in to get the token
        login_res = requests.post(f"{BASE_URL}/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD})
        login_res.raise_for_status() # Raise an exception for bad status codes
        
        jwt_token = login_res.json()["token"]
        print(f"Successfully logged in. Token acquired.")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error during login: {e}")
        return False

def upload_test_image():
    """Upload a single image to be used for all processing requests."""
    global image_id
    print("\n--- Step 2: Uploading Test Image ---")
    if not os.path.exists(IMAGE_PATH):
        print(f"Error: Test image '{IMAGE_PATH}' not found. Please create it.")
        return False
    
    try:
        headers = {"Authorization": f"Bearer {jwt_token}"}
        with open(IMAGE_PATH, "rb") as f:
            files = {"image": (IMAGE_PATH, f, "image/jpeg")}
            upload_res = requests.post(f"{BASE_URL}/images/upload", headers=headers, files=files)
            upload_res.raise_for_status()
            
            # The image ID is the unique filename
            image_id = upload_res.json()["imageId"].replace("image:", "")
            print(f"Image uploaded successfully. Image ID: {image_id}")
            return True
    except requests.exceptions.RequestException as e:
        print(f"Error during image upload: {e}")
        return False

def send_processing_request():
    """Send a single, heavy processing request to the server."""
    if not jwt_token or not image_id:
        return
        
    try:
        headers = {"Authorization": f"Bearer {jwt_token}"}
        # ensure we don't chain on previous test results
        payload = {**CPU_payload, "source": image_id}
        
        requests.post(f"{BASE_URL}/images/{image_id}/process", headers=headers, json=payload)
        print(".", end="", flush=True) # Print a dot for each successful request
    except requests.exceptions.RequestException:
        print("x", end="", flush=True) # Print an 'x' for each failed request

def start_load_test():
    """Run the load test by sending concurrent requests for a set duration."""
    print("\n--- Step 3: Starting Load Test ---")
    print(f"Sending {CONCURRENT_REQUESTS} concurrent requests for {TEST_DURATION_SECONDS} seconds...")
    
    end_time = time.time() + TEST_DURATION_SECONDS
    while time.time() < end_time:
        threads = []
        for _ in range(CONCURRENT_REQUESTS):
            thread = threading.Thread(target=send_processing_request)
            threads.append(thread)
            thread.start()
        
        for thread in threads:
            thread.join()
        
        time.sleep(0.1) # Small delay to prevent overwhelming the client machine
    
    print("\n\nLoad test finished.")

if __name__ == "__main__":
    if register_and_login():
        if upload_test_image():
            start_load_test()