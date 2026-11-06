package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/AJAmit17/luther/server/internal/lifecycle"
)

func (c *CLI) running() bool {
	res, err := (&http.Client{Timeout: time.Second}).Get(c.localURL() + "/healthz")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var health struct {
		OK      bool
		Version string
	}
	return res.StatusCode == http.StatusOK && json.NewDecoder(res.Body).Decode(&health) == nil && health.OK && health.Version != ""
}

func (c *CLI) Start() error {
	if c.running() {
		fmt.Println("Luther is already running on", c.localURL())
		return nil
	}
	bin, err := os.Executable()
	if err != nil {
		return err
	}
	if err := lifecycle.Start(bin); err != nil {
		return err
	}
	return c.waitUp()
}

func (c *CLI) Stop() error {
	if !lifecycle.Loaded() && c.running() {
		return fmt.Errorf("the server is running in the foreground, not as a managed service; stop that luther serve process with Ctrl-C")
	}
	if err := lifecycle.Stop(); err != nil {
		return err
	}
	for range 40 {
		if !c.running() {
			fmt.Println("Luther stopped; idle sleep is allowed again.")
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("the server is still answering; see ~/.luther/serve.log")
}

func (c *CLI) Status() {
	if c.running() {
		fmt.Println("Luther is running on", c.localURL(), "· logs: ~/.luther/serve.log")
	} else {
		fmt.Println("Luther is stopped. Run `luther start`.")
	}
}
