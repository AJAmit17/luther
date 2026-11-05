# Homebrew formula, tapped straight from this repository:
#   brew tap AJAmit17/luther https://github.com/AJAmit17/luther && brew install luther
# Before the first release: brew install --HEAD luther
# The release workflow keeps `tag` and `revision` on the latest release.
class Luther < Formula
  desc "Drive the coding agents on your Mac (Claude Code, Codex, more) from your phone"
  homepage "https://github.com/AJAmit17/luther"
  url "https://github.com/AJAmit17/luther.git", tag: "v0.1.0", revision: "0000000000000000000000000000000000000000"
  license :cannot_represent
  head "https://github.com/AJAmit17/luther.git", branch: "main"

  depends_on "go" => :build
  depends_on "tmux"

  def install
    cd "server" do
      ldflags = "-s -w -X github.com/AJAmit17/luther/server/internal/protocol.Version=#{version}"
      system "go", "build", *std_go_args(ldflags:, output: bin/"luther")
    end
  end

  # `brew services start luther`, or Luther's own `luther service install`.
  service do
    run [opt_bin/"luther", "serve"]
    keep_alive true
    log_path var/"log/luther.log"
    error_log_path var/"log/luther.log"
  end

  def caveats
    <<~EOS
      Set up a route and pair your phone:
        luther doctor
        luther tailscale        # and/or: luther tunnel
        luther service install  # or: brew services start luther
        luther pair
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/luther version")
  end
end
