import time, signal, sys

def graceful_shutdown(signum, frame):
    print (f"\n[+] Received SIGTERM {signum}. Flushing I/0 buffers and tearing down DB connectiops...") 
    time.sleep(2)
    print (" [+] System offline,")
    sys. exit (0)
signal.signal(signal.SIGTERM, graceful_shutdown)

print ("[+] Mock Server initialized on Port 8080.")
while True:
    print ("[+] Processing task queue...")
    time. sleep(3)