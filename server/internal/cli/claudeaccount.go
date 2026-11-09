package cli

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/AJAmit17/luther/server/internal/claudeaccounts"
)

// claudeAccountCmd: `luther claude-account add|list|use|remove`. Tokens go
// only into ~/.luther/claude-accounts.json; the claude CLI's login is never
// touched.
func claudeAccountCmd(args cobra.PositionalArgs, groupHelp func(*cobra.Command, []string) error) *cobra.Command {
	group := &cobra.Command{Use: "claude-account", Short: "Run Claude threads under another Claude account", GroupID: "manage",
		Args: args, RunE: groupHelp, SuggestionsMinimumDistance: 2}
	add := &cobra.Command{
		Use: "add [NAME]", Short: "Store a token from `claude setup-token` (read from stdin)", Args: cobra.MaximumNArgs(1),
		Example: "  CLAUDE_CONFIG_DIR=$(mktemp -d) claude setup-token   # sign in as the other account; prints a token\n" +
			"  luther claude-account add \"Desktop app\"            # paste it\n" +
			"  luther claude-account use \"Desktop app\"",
		RunE: func(cmd *cobra.Command, args []string) error {
			name := claudeaccountsDefault
			if len(args) == 1 {
				name = args[0]
			}
			tok, err := readToken(cmd.InOrStdin(), cmd.ErrOrStderr())
			if err != nil {
				return err
			}
			if err := claudeaccounts.Add(name, tok); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Stored %q. Use it for new Claude threads: luther claude-account use %q\n", name, name)
			return nil
		},
	}
	list := &cobra.Command{Use: "list", Short: "List Claude accounts (* = in use)", Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			names, active := claudeaccounts.Names()
			mark := func(on bool) string {
				if on {
					return "*"
				}
				return " "
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s %s (the claude CLI's own login)\n", mark(active == ""), claudeaccounts.Terminal)
			for _, n := range names {
				fmt.Fprintf(cmd.OutOrStdout(), "%s %s\n", mark(n == active), n)
			}
			return nil
		}}
	use := &cobra.Command{Use: "use NAME", Short: "Run new Claude threads under NAME (Terminal = the CLI's login)", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := claudeaccounts.Use(args[0]); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "New Claude threads run under %s; open ones keep theirs until restarted.\n", args[0])
			return nil
		}}
	remove := &cobra.Command{Use: "remove NAME", Short: "Forget a stored account", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error { return claudeaccounts.Remove(args[0]) }}
	group.AddCommand(add, list, use, remove)
	return group
}

const claudeaccountsDefault = "Desktop app" // matches claudedesktop's row, so its usage shows as one

// readToken: hidden input on a terminal, else the first line of stdin.
func readToken(in io.Reader, prompt io.Writer) (string, error) {
	if f, ok := in.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
		fmt.Fprint(prompt, "Paste the token from `claude setup-token`: ")
		b, err := term.ReadPassword(int(f.Fd()))
		fmt.Fprintln(prompt)
		return strings.TrimSpace(string(b)), err
	}
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	return strings.TrimSpace(line), nil
}
