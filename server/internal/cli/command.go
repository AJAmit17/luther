package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/AJAmit17/luther/server/internal/config"
	"github.com/AJAmit17/luther/server/internal/protocol"
	"github.com/spf13/cobra"
)

func Execute(args []string, out, errOut io.Writer, serve func(*config.Config)) error {
	root := command(serve)
	root.SetArgs(args)
	root.SetOut(out)
	root.SetErr(errOut)
	if err := root.Execute(); err != nil {
		noColor, _ := root.PersistentFlags().GetBool("no-color")
		view := newPresentation(errOut, noColor)
		fmt.Fprintf(view.out, "%s %s\n\nRun 'luther --help' for available commands.\n", view.label("Error:", "#E45B56"), err)
		return err
	}
	return nil
}

func command(serve func(*config.Config)) *cobra.Command {
	noColor := false
	root := &cobra.Command{
		Use: "luther", Short: "Your coding agents. Anywhere.",
		Long:    "Steer the coding agents on your Mac from your phone, over your tailnet or an encrypted tunnel.",
		Version: protocol.Version, SilenceUsage: true, SilenceErrors: true,
		SuggestionsMinimumDistance: 2,
		Args: func(cmd *cobra.Command, args []string) error {
			if err := cobra.NoArgs(cmd, args); err != nil {
				if suggestions := cmd.SuggestionsFor(args[0]); len(suggestions) > 0 {
					return fmt.Errorf("%w\n\nDid you mean?\n  %s", err, strings.Join(suggestions, "\n  "))
				}
				return err
			}
			return nil
		},
		Example:           "  luther start\n  luther pair\n  luther status\n  luther doctor",
		CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	}
	root.PersistentFlags().BoolVar(&noColor, "no-color", false, "disable terminal colors")
	root.SetVersionTemplate("luther {{.Version}}\n")
	root.AddGroup(
		&cobra.Group{ID: "server", Title: "Server"},
		&cobra.Group{ID: "connect", Title: "Connect your phone"},
		&cobra.Group{ID: "manage", Title: "Manage"},
		&cobra.Group{ID: "tools", Title: "Help and tools"},
	)
	root.SetHelpCommandGroupID("tools")
	help := root.HelpFunc()
	root.SetHelpFunc(func(cmd *cobra.Command, args []string) {
		if cmd == root {
			newPresentation(cmd.OutOrStdout(), noColor).brand()
		}
		help(cmd, args)
	})
	run := func(readOnly bool, fn func(*CLI, []string) error) func(*cobra.Command, []string) error {
		return func(cmd *cobra.Command, args []string) error {
			load := config.Load
			if readOnly {
				load = config.Read
			}
			cfg, err := load()
			if err != nil {
				return err
			}
			c := New(cfg)
			c.out = cmd.OutOrStdout()
			c.view = newPresentation(c.out, noColor)
			return fn(c, args)
		}
	}
	root.RunE = run(true, func(c *CLI, _ []string) error {
		c.view.brand()
		c.Status(false)
		fmt.Fprintln(c.out, "\n  Start       luther start\n  Pair phone  luther pair\n  Check setup luther doctor\n  Explore     luther --help")
		return nil
	})
	add := func(use, short, group string, readOnly bool, fn func(*CLI, []string) error) *cobra.Command {
		cmd := &cobra.Command{Use: use, Short: short, GroupID: group, Args: cobra.NoArgs, RunE: run(readOnly, fn)}
		root.AddCommand(cmd)
		return cmd
	}
	add("start", "Run in the background and prevent idle sleep", "server", false, func(c *CLI, _ []string) error { return c.Start() })
	add("stop", "Stop the managed server and release wake protection", "server", true, func(c *CLI, _ []string) error { return c.Stop() })
	statusJSON := false
	status := add("status", "Show the server, routes, and paired phones", "server", true, func(c *CLI, _ []string) error { return c.Status(statusJSON) })
	status.Flags().BoolVar(&statusJSON, "json", false, "print machine-readable status without decoration")
	add("serve", "Run in the foreground (used by service managers)", "server", false, func(c *CLI, _ []string) error { serve(c.cfg); return nil })
	pairJSON := false
	pair := add("pair", "Print a QR code to pair your phone", "connect", false, func(c *CLI, _ []string) error { return c.Pair(pairJSON) })
	pair.Flags().BoolVar(&pairJSON, "json", false, "print only the pairing payload (for remote pairing)")
	https, force := 443, false
	tailscale := add("tailscale", "Publish Luther on your tailnet", "connect", false, func(c *CLI, _ []string) error { return c.Tailscale(https, force, false) })
	tailscale.Flags().IntVar(&https, "https", 443, "HTTPS port on the tailnet")
	tailscale.Flags().BoolVar(&force, "force", false, "replace an existing mapping on that port")
	tailscale.Args = validPort("https", cobra.NoArgs)
	funnelPort := 8443
	funnel := add("funnel", "Publish Luther on the internet with Tailscale Funnel (the phone needs no Tailscale)", "connect", false, func(c *CLI, _ []string) error { return c.Tailscale(funnelPort, true, true) })
	funnel.Flags().IntVar(&funnelPort, "https", 8443, "HTTPS port: 443, 8443 or 10000")
	funnel.Args = validPort("https", cobra.NoArgs)
	url, tunnelID := "", ""
	quickOn, quickOff := false, false
	tunnel := add("tunnel", "Configure a Cloudflare tunnel route (--quick: no account needed)", "connect", false, func(c *CLI, _ []string) error {
		if quickOn || quickOff {
			return c.QuickTunnel(quickOff)
		}
		return c.Tunnel(url, tunnelID)
	})
	tunnel.Flags().BoolVar(&quickOn, "quick", false, "start a Cloudflare quick tunnel: no account, a random trycloudflare.com address")
	tunnel.Flags().BoolVar(&quickOff, "quick-off", false, "stop the quick tunnel")
	tunnel.Flags().StringVar(&url, "url", "", "public HTTPS URL")
	tunnel.Flags().StringVar(&tunnelID, "id", "", "existing Cloudflare tunnel UUID")
	tunnel.Example = "  luther tunnel --quick\n  luther tunnel --url https://luther.example.com --id <UUID>"
	groupHelp := func(cmd *cobra.Command, _ []string) error { return cmd.Help() }
	service := &cobra.Command{Use: "service", Short: "Manage startup at login", GroupID: "manage", Args: root.Args, RunE: groupHelp, SuggestionsMinimumDistance: 2}
	for _, action := range []string{"install", "uninstall"} {
		service.AddCommand(&cobra.Command{Use: action, Short: action + " the login service", Args: cobra.NoArgs,
			RunE: run(false, func(c *CLI, _ []string) error { return c.Service(action) })})
	}
	root.AddCommand(service)
	remote := &cobra.Command{Use: "remote", Short: "Reach other agent machines over SSH", GroupID: "manage", Args: root.Args, RunE: groupHelp, SuggestionsMinimumDistance: 2}
	port, sshArg := config.DefaultPort, ""
	for _, item := range []struct {
		name, short, args string
		n                 int
	}{
		{"add", "Connect another machine over SSH", " NAME user@host", 2},
		{"pair", "Pair with a remote through this Mac", " NAME", 1},
		{"list", "List configured remote machines", "", 0},
		{"remove", "Remove a relay without stopping the remote server", " NAME", 1},
	} {
		cmd := &cobra.Command{Use: item.name + item.args, Short: item.short, Args: cobra.ExactArgs(item.n),
			RunE: run(item.name == "list", func(c *CLI, args []string) error { return c.Remote(append([]string{item.name}, args...), port, sshArg) })}
		if item.name == "add" {
			cmd.Flags().IntVar(&port, "port", config.DefaultPort, "Luther port on the remote machine")
			cmd.Flags().StringVar(&sshArg, "ssh", "", `extra SSH flag, e.g. "-p 2222"`)
			cmd.Args = validPort("port", cobra.ExactArgs(2))
			cmd.Example = "  luther remote add devbox me@devbox\n  luther remote add devbox me@devbox --port 47900 --ssh \"-p 2222\""
		}
		remote.AddCommand(cmd)
	}
	root.AddCommand(remote)
	add("doctor", "Check agent CLIs, server, routes, and pairing", "manage", true, func(c *CLI, _ []string) error { c.Doctor(); return nil })
	root.AddCommand(&cobra.Command{Use: "version", Short: "Print the Luther build version", GroupID: "tools", Args: cobra.NoArgs,
		Run: func(cmd *cobra.Command, _ []string) { fmt.Fprintln(cmd.OutOrStdout(), "luther", protocol.Version) }})
	root.AddCommand(&cobra.Command{
		Use: "completion [bash|zsh|fish|powershell]", Short: "Generate shell completion", GroupID: "tools",
		ValidArgs: []string{"bash", "zsh", "fish", "powershell"}, Args: cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
		Example: "  luther completion zsh > \"${fpath[1]}/_luther\"\n  luther completion bash > ~/.local/share/bash-completion/completions/luther",
		RunE: func(cmd *cobra.Command, args []string) error {
			switch args[0] {
			case "bash":
				return root.GenBashCompletionV2(cmd.OutOrStdout(), true)
			case "zsh":
				return root.GenZshCompletion(cmd.OutOrStdout())
			case "fish":
				return root.GenFishCompletion(cmd.OutOrStdout(), true)
			default:
				return root.GenPowerShellCompletionWithDesc(cmd.OutOrStdout())
			}
		},
	})
	return root
}

func validPort(flag string, args cobra.PositionalArgs) cobra.PositionalArgs {
	return func(cmd *cobra.Command, values []string) error {
		if err := args(cmd, values); err != nil {
			return err
		}
		port, err := cmd.Flags().GetInt(flag)
		if err != nil {
			return err
		}
		if port < 1 || port > 65535 {
			return fmt.Errorf("--%s must be between 1 and 65535", flag)
		}
		return nil
	}
}
