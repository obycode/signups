async function cancelSignup(id) {
  if (confirm("Are you sure you want to cancel?")) {
    // Cancel the signup
    const response = await fetch("/signup", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signup: id }),
    });
    console.log("Response:", response);

    if (response.ok) {
      console.log("Success");
      location.assign("/user?success=1");
    } else {
      console.log("Failure");
      location.assign("/user?error=1");
    }
  }
}
